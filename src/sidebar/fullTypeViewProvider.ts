import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { parseWebviewMessage, type ViewState, type WebviewUpdate } from "../shared/protocol";
import { renderHtml, renderViewContent, renderPaletteProperties } from "./renderHtml";
import type { ThemeTokenPalette } from "./themePalette";
import { resolveActiveThemeTokenPalette } from "./themePaletteResolver";

export const VIEW_ID = "fullTypeViewer.type";

export interface FullTypeViewEvents {
  readonly onVisibilityChanged: (visible: boolean) => void;
  readonly onToggle: (viewNodeId: string) => void;
  readonly onGoToDefinition: (viewNodeId: string, target: "symbol" | "type") => void;
}

export class FullTypeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private state: ViewState = { kind: "idle", message: "Place the cursor on a TypeScript symbol." };
  private palette: ThemeTokenPalette = {};
  private paletteRequest = 0;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly viewDisposables: vscode.Disposable[] = [];
  private ready = false;

  /**
   * Initialize webview resources, visibility callbacks, and theme subscriptions.
   * @param extensionUri Extension root used to resolve local webview resources.
   * @param events Host callbacks for view visibility and disclosure messages.
   * @param wordWrap Whether long rows wrap inside the view.
   */
  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly events: FullTypeViewEvents,
    private wordWrap: boolean,
  ) {
    this.disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("workbench.colorTheme")) {
        void this.refreshPalette();
      }
    }));
    void this.refreshPalette();
  }

  public get visible(): boolean {
    return this.view?.visible === true;
  }

  /**
   * Attach the view transport and restore the current presentation after readiness.
   * @param view Sidebar state and presentation transport.
   */
  public resolveWebviewView(view: vscode.WebviewView): void {
    this.releaseView();
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    this.viewDisposables.push(
      view.onDidChangeVisibility(() => this.events.onVisibilityChanged(view.visible)),
      view.webview.onDidReceiveMessage((raw: unknown) => {
        const message = parseWebviewMessage(raw);
        if (message?.type === "toggle") this.events.onToggle(message.viewNodeId);
        else if (message?.type === "goToDefinition") this.events.onGoToDefinition(message.viewNodeId, message.target);
        else if (message?.type === "ready") {
          this.ready = true;
          this.render();
        }
      }),
      view.onDidDispose(() => {
        this.releaseView();
        this.events.onVisibilityChanged(false);
      }),
    );
    const nonce = randomBytes(18).toString("base64url");
    view.webview.html = renderHtml(this.state, {
      scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")),
      nonce, palette: this.palette, wordWrap: this.wordWrap,
    });
    this.events.onVisibilityChanged(view.visible);
  }

  /**
   * Store the latest host state and update an attached webview.
   * @param state Resolution or disclosure state to present.
   */
  public setState(state: ViewState): void {
    this.state = state;
    this.render();
  }

  public getState(): ViewState {
    return this.state;
  }

  /**
   * Persist the wrapping preference and update the view and command context together.
   * @param enabled Whether long type rows should wrap.
   */
  public setWordWrap(enabled: boolean): void {
    if (enabled === this.wordWrap) {
      return;
    }
    this.wordWrap = enabled;
    this.render();
  }

  /**
   * Release subscriptions and prevent further work after teardown.
   */
  public dispose(): void {
    this.paletteRequest += 1;
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.releaseView();
  }

  /**
   * Release subscriptions associated with the current webview instance.
   */
  private releaseView(): void {
    this.ready = false;
    for (const disposable of this.viewDisposables.splice(0)) disposable.dispose();
    this.view = undefined;
  }

  /**
   * Publish the current presentation to the sidebar.
   */
  private render(): void {
    const webview = this.view?.webview;
    if (webview === undefined) {
      return;
    }
    if (!this.ready) return;
    const update: WebviewUpdate = {
      type: "render",
      generation: this.state.kind === "success" ? String(this.state.result.generation) : "",
      html: renderViewContent(this.state, this.wordWrap),
      paletteCss: renderPaletteProperties(this.palette),
    };
    void webview.postMessage(update);
  }

  /**
   * Resolve active-theme colors and publish only the newest asynchronous palette result.
   */
  private async refreshPalette(): Promise<void> {
    const request = ++this.paletteRequest;
    const palette = await resolveActiveThemeTokenPalette();
    if (request !== this.paletteRequest) {
      return;
    }
    this.palette = palette;
    this.render();
  }
}
