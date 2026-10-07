import * as vscode from "vscode";

/** User-visible row fields read from the rendered sidebar DOM. */
export interface TreeRow {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly iconClass: string;
  readonly expanded?: boolean;
  readonly recursive: boolean;
  readonly children: readonly TreeRow[];
}

/** A rendered sidebar tree paired with the contributed Copy command output. */
export interface ViewPresentation {
  readonly name: string;
  readonly rawText: string;
  readonly metadata: string;
  readonly notice?: string;
  readonly root: TreeRow;
}

interface DebugMessage {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly method?: string;
  readonly sessionId?: string;
  readonly params?: { readonly sessionId?: string; readonly executionContextId?: number; readonly context?: { readonly id: number } };
}

interface EvaluationResult {
  readonly result?: { readonly value?: unknown };
  readonly exceptionDetails?: unknown;
}

interface ExecutionContext {
  readonly id: number;
  readonly sessionId?: string;
}

/** Drive the actual rendered webview through Chromium's test-only debugging port. */
export class ViewDriver {
  private readonly contexts: ExecutionContext[] = [];
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  private closed = false;
  private attachmentError: unknown;

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as DebugMessage;
      const pending = message.id === undefined ? undefined : this.pending.get(message.id);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(message.id!);
        if (message.error !== undefined) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      }
      if (message.method === "Runtime.executionContextCreated" && message.params?.context !== undefined) this.contexts.push({ id: message.params.context.id, ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }) });
      if (message.method === "Runtime.executionContextDestroyed") {
        const index = this.contexts.findIndex((context) => context.id === message.params?.executionContextId && context.sessionId === message.sessionId);
        if (index >= 0) this.contexts.splice(index, 1);
      }
      if (message.method === "Runtime.executionContextsCleared") {
        for (let index = this.contexts.length - 1; index >= 0; index--) {
          if (this.contexts[index]?.sessionId === message.sessionId) this.contexts.splice(index, 1);
        }
      }
      if (message.method === "Target.attachedToTarget") {
        void this.send("Runtime.enable", {}, message.params?.sessionId).catch((error: unknown) => {
          if (!this.closed) this.attachmentError = error;
        });
      }
    });
  }

  /** Connect to the workbench renderer without exporting any extension internals. */
  public static async connect(port: string): Promise<ViewDriver> {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const target = targets.find((candidate) => candidate.type === "page");
    if (target === undefined) throw new Error("Workbench renderer was not exposed for integration testing.");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not attach the integration browser driver.")), { once: true });
    });
    const driver = new ViewDriver(socket);
    await driver.send("Runtime.enable");
    await driver.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    return driver;
  }

  /** Send one debugging command with a timeout and correlate its response. */
  private send<T = unknown>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 10_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
    });
  }

  /** Evaluate only inside the extension's webview document. */
  private async evaluate<T>(expression: string): Promise<T | undefined> {
    if (this.attachmentError !== undefined) throw this.attachmentError;
    for (const context of [...this.contexts]) {
      try {
        const result = await this.send<EvaluationResult>("Runtime.evaluate", {
          expression: `document.getElementById("content") === null ? undefined : (${expression})`,
          contextId: context.id, returnByValue: true,
        }, context.sessionId);
        if (result.result?.value !== undefined) return result.result.value as T;
      } catch { /* Detached frames disappear while VS Code creates the webview. */ }
    }
    return undefined;
  }

  /** Read labels, disclosure state, and metadata visible to the sidebar user. */
  public async read(): Promise<ViewPresentation | undefined> {
    const visible = await this.evaluate<Omit<ViewPresentation, "rawText">>(`(() => {
      const root = document.querySelector('[role="tree"] > li > [role="treeitem"]');
      if (root === null) return undefined;
      const row = (item) => ({
        id: item.dataset.nodeId,
        label: item.querySelector(':scope > .tree-row .tree-label').textContent,
        summary: item.querySelector(':scope > .tree-row .tree-description').textContent,
        iconClass: item.querySelector(':scope > .tree-row .tree-icon').className.replace('tree-icon icon-', ''),
        ...(item.hasAttribute('aria-expanded') ? { expanded: item.getAttribute('aria-expanded') === 'true' } : {}),
        recursive: item.getAttribute('aria-label').endsWith(', recursive reference'),
        children: [...item.querySelectorAll(':scope > [role="group"] > li > [role="treeitem"]')].map(row),
      });
      return { name: row(root).label, root: row(root), metadata: document.querySelector('.metadata').textContent,
        ...(document.querySelector('.notice') === null ? {} : { notice: document.querySelector('.notice').textContent }) };
    })()`);
    if (visible === undefined) return undefined;
    const rawText = await vscode.commands.executeCommand<string>("fullTypeViewer.copy");
    if (rawText === undefined || !rawText.includes(`type ${visible.name} =`)) return undefined;
    return { ...visible, rawText };
  }

  /** Wait for the visible view and Copy output to reflect the requested symbol. */
  public async wait(name: string, predicate: (view: ViewPresentation) => boolean = () => true): Promise<ViewPresentation> {
    const deadline = Date.now() + 60_000;
    let last: ViewPresentation | undefined;
    while (Date.now() < deadline) {
      last = await this.read();
      if (last?.name === name && predicate(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for rendered ${name}: ${JSON.stringify(last)}`);
  }

  /** Click a real disclosure row and wait for its visible state to change. */
  public async toggle(id: string, name: string): Promise<ViewPresentation> {
    const before = await this.evaluate<boolean>(`(() => {
      const row = [...document.querySelectorAll('[role="treeitem"]')].find((item) => item.dataset.nodeId === ${JSON.stringify(id)});
      if (row === undefined || !row.hasAttribute('aria-expanded')) throw new Error('Missing expandable row');
      const expanded = row.getAttribute('aria-expanded') === 'true';
      row.querySelector(':scope > .tree-row').click();
      return expanded;
    })()`);
    if (before === undefined) throw new Error("Disclosure row was unavailable.");
    return this.wait(name, (view) => findRow(view.root, (row) => row.id === id)?.expanded === !before);
  }

  /** Close the integration browser transport and reject outstanding commands. */
  public close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Integration browser driver closed."));
    }
    this.pending.clear();
    this.socket.close();
  }
}

/** Find a visible row by its user-facing relationship or presentation. */
export function findRow(root: TreeRow, predicate: (row: TreeRow) => boolean): TreeRow | undefined {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findRow(child, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}
