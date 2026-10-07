import * as vscode from "vscode";
import { RequestCancelledError } from "../shared/cancellation";
import { errorMessage, UserVisibleError } from "../shared/errors";
import type { CompleteTypeProvider } from "../native/completeTypeProvider";
import type { FullTypeViewProvider } from "../sidebar/fullTypeViewProvider";
import type { ExpansionController } from "./expansionController";
import {
  isSameCachedSymbol,
  ResolutionGeneration,
  type SymbolFocusCache,
} from "./resolutionState";

const IDLE_MESSAGE = "Place the cursor on a TypeScript symbol.";

export class FocusController implements vscode.Disposable {
  private readonly generation = new ResolutionGeneration();
  private focusCache: SymbolFocusCache | undefined;
  private disposed = false;
  private cancellation = new AbortController();
  private readonly disposables: vscode.Disposable[] = [];

  /**
   * Initialize ownership and event subscriptions for this component.
   * @param provider Native type resolver used for editor focus.
   * @param expansion Controller that owns the displayed graph session.
   * @param view Sidebar state and presentation transport.
   */
  public constructor(
    private readonly provider: Pick<CompleteTypeProvider, "resolve" | "onDidInvalidate">,
    private readonly expansion: Pick<ExpansionController, "replace">,
    private readonly view: Pick<FullTypeViewProvider, "visible" | "setState">,
  ) {
    this.disposables.push(
      provider.onDidInvalidate(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule(false)),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.schedule(false);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.focusCache = undefined;
          this.invalidate();
          void this.expansion.replace(undefined);
          this.schedule(false, false);
        }
      }),
    );
  }

  /**
   * Pause hidden-view work and refresh when the sidebar becomes visible.
   * @param visible Whether the sidebar can currently display results.
   */
  public onVisibilityChanged(visible: boolean): void {
    if (!visible) {
      this.invalidate();
      this.focusCache = undefined;
      void this.expansion.replace(undefined);
      return;
    }
    this.resolveImmediately(false);
  }

  /**
   * Invalidate the cached symbol and request a fresh semantic resolution.
   */
  public refresh(): void {
    this.focusCache = undefined;
    this.invalidate();
    void this.expansion.replace(undefined);
    this.resolveImmediately(true);
  }

  /**
   * Release subscriptions and prevent further work after teardown.
   */
  public dispose(): void {
    this.disposed = true;
    this.invalidate();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  /**
   * Replace pending work with a delayed callback for the current generation.
   * @param force Whether to bypass the cached symbol result.
   * @param invalidate Whether scheduling should supersede existing resolution work.
   */
  private schedule(force: boolean, invalidate = true): void {
    if (invalidate) {
      this.invalidate();
    }
    if (!this.view.visible || this.disposed) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!isEligibleEditor(editor)) {
      void this.showIdle();
      return;
    }
    const offset = selectedSymbolOffset(editor);
    if (offset === undefined) {
      void this.showIdle();
      return;
    }
    if (!force && this.isSameCachedSymbol(editor.document, offset)) {
      return;
    }
    this.focusCache = undefined;
    void this.expansion.replace(undefined);
    this.generation.schedule(250, (generation) => void this.resolve(generation, force));
  }

  /**
   * Cancel the debounce timer and resolve the current editor selection.
   * @param force Whether to bypass the cached symbol result.
   */
  private resolveImmediately(force: boolean): void {
    this.invalidate();
    if (!this.view.visible || this.disposed) {
      return;
    }
    const generation = this.generation.current();
    void this.resolve(generation, force);
  }

  /**
   * Resolve the captured request and discard results superseded by newer focus.
   * @param generation Identity of the request or result being processed.
   * @param force Whether to bypass the cached symbol result.
   */
  private async resolve(generation: number, force: boolean): Promise<void> {
    if (this.isStale(generation) || !this.view.visible) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!isEligibleEditor(editor)) {
      await this.showIdle();
      return;
    }
    const offset = selectedSymbolOffset(editor);
    if (offset === undefined) {
      await this.showIdle();
      return;
    }
    if (!force && this.isSameCachedSymbol(editor.document, offset)) {
      return;
    }
    const position = editor.document.positionAt(offset);
    const word = editor.document.getText(editor.document.getWordRangeAtPosition(position));
    this.view.setState({ kind: "loading", message: `Resolving ${word || "symbol"}...` });
    try {
      const uri = editor.document.uri.toString();
      const version = editor.document.version;
      const session = await this.provider.resolve({
        uri,
        version,
        text: editor.document.getText(),
        signal: this.cancellation.signal,
        offset,
        generation,
      });
      if (this.isStale(generation) || !this.view.visible) {
        await session?.dispose();
        return;
      }
      if (session === undefined) {
        this.focusCache = undefined;
        this.view.setState({ kind: "idle", message: IDLE_MESSAGE });
        await this.expansion.replace(undefined);
        return;
      }
      this.focusCache = {
        uri,
        version,
        start: session.focus.start,
        end: session.focus.end,
      };
      await this.expansion.replace(session);
    } catch (error) {
      if (this.isStale(generation) || error instanceof RequestCancelledError) {
        return;
      }
      const message = errorMessage(error);
      this.view.setState({ kind: "error", message });
      await this.expansion.replace(undefined);
      if (!(error instanceof UserVisibleError)) {
        void vscode.window.showErrorMessage(`Full Type Viewer: ${message}`);
      }
    }
  }

  /**
   * Release the active type session and display guidance for selecting a symbol.
   */
  private async showIdle(): Promise<void> {
    this.focusCache = undefined;
    this.view.setState({ kind: "idle", message: IDLE_MESSAGE });
    await this.expansion.replace(undefined);
  }

  /**
   * Reuse a result only within the same document version and symbol range.
   * @param document Editor document supplying source text and offsets.
   * @param offset Zero-based source offset within the selected identifier.
   */
  private isSameCachedSymbol(document: vscode.TextDocument, offset: number): boolean {
    return isSameCachedSymbol(
      this.focusCache,
      document.uri.toString(),
      document.version,
      offset,
    );
  }

  /**
   * Advance the generation so earlier asynchronous work cannot publish.
   */
  private invalidate(): void {
    this.cancellation.abort();
    this.cancellation = new AbortController();
    this.generation.invalidate();
  }

  private isStale(generation: number): boolean {
    return this.disposed || !this.generation.isCurrent(generation);
  }
}

/**
 * Restrict semantic resolution to supported TypeScript and JavaScript documents.
 * @param editor Editor supplying the active document and selection.
 */
function isEligibleEditor(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
  if (editor === undefined) {
    return false;
  }
  const document = editor.document;
  return (
    (document.languageId === "typescript" || document.languageId === "typescriptreact") &&
    document.uri.scheme === "file" &&
    editor.selections.length === 1
  );
}

/**
 * Accept a cursor or selection only when it belongs to one identifier.
 * @param editor Editor supplying the active document and selection.
 */
export function selectedSymbolOffset(editor: vscode.TextEditor): number | undefined {
  const { document, selection } = editor;
  if (selection.isEmpty) {
    return document.offsetAt(selection.active);
  }
  const start = document.offsetAt(selection.start);
  const end = document.offsetAt(selection.end);
  const wordRange = document.getWordRangeAtPosition(selection.start);
  if (wordRange === undefined) {
    return undefined;
  }
  const wordStart = document.offsetAt(wordRange.start);
  const wordEnd = document.offsetAt(wordRange.end);
  return start >= wordStart && end <= wordEnd ? start : undefined;
}
