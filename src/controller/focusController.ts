import * as vscode from "vscode";
import { errorMessage, UserVisibleError } from "../shared/errors";
import { CompleteTypeProvider } from "../native/completeTypeProvider";
import { FullTypeViewProvider } from "../sidebar/fullTypeViewProvider";
import { ExpansionController } from "./expansionController";
import {
  isSameCachedAlias,
  ResolutionGeneration,
  type AliasFocusCache,
} from "./resolutionState";

const IDLE_MESSAGE = "Place the cursor on a type alias name.";

export class FocusController implements vscode.Disposable {
  private readonly generation = new ResolutionGeneration();
  private focusCache: AliasFocusCache | undefined;
  private disposed = false;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly provider: CompleteTypeProvider,
    private readonly expansion: ExpansionController,
    private readonly view: FullTypeViewProvider,
  ) {
    this.disposables.push(
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

  public onVisibilityChanged(visible: boolean): void {
    if (!visible) {
      this.invalidate();
      this.focusCache = undefined;
      void this.expansion.replace(undefined);
      return;
    }
    this.resolveImmediately(false);
  }

  public refresh(): void {
    this.focusCache = undefined;
    this.invalidate();
    void this.expansion.replace(undefined);
    this.resolveImmediately(true);
  }

  public dispose(): void {
    this.disposed = true;
    this.invalidate();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

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
    const offset = editor.document.offsetAt(editor.selection.active);
    if (!force && this.isSameCachedAlias(editor.document, offset)) {
      return;
    }
    this.generation.schedule(250, (generation) => void this.resolve(generation, force));
  }

  private resolveImmediately(force: boolean): void {
    this.invalidate();
    if (!this.view.visible || this.disposed) {
      return;
    }
    const generation = this.generation.current();
    void this.resolve(generation, force);
  }

  private async resolve(generation: number, force: boolean): Promise<void> {
    if (this.isStale(generation) || !this.view.visible) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!isEligibleEditor(editor)) {
      await this.showIdle();
      return;
    }
    const offset = editor.document.offsetAt(editor.selection.active);
    if (!force && this.isSameCachedAlias(editor.document, offset)) {
      return;
    }
    const word = editor.document.getText(editor.document.getWordRangeAtPosition(editor.selection.active));
    this.view.setState({ kind: "loading", message: `Resolving ${word || "type alias"}...` });
    try {
      const session = await this.provider.resolve({
        document: editor.document,
        offset,
        generation,
      });
      if (this.isStale(generation) || !this.view.visible) {
        await session?.dispose();
        return;
      }
      if (session === undefined) {
        this.focusCache = undefined;
        await this.expansion.replace(undefined);
        this.view.setState({ kind: "idle", message: IDLE_MESSAGE });
        return;
      }
      this.focusCache = {
        uri: editor.document.uri.toString(),
        version: editor.document.version,
        start: session.focus.start,
        end: session.focus.end,
      };
      await this.expansion.replace(session);
    } catch (error) {
      if (this.isStale(generation)) {
        return;
      }
      await this.expansion.replace(undefined);
      const message = errorMessage(error);
      this.view.setState({ kind: "error", message });
      if (!(error instanceof UserVisibleError)) {
        void vscode.window.showErrorMessage(`Full Type Viewer: ${message}`);
      }
    }
  }

  private async showIdle(): Promise<void> {
    this.focusCache = undefined;
    await this.expansion.replace(undefined);
    this.view.setState({ kind: "idle", message: IDLE_MESSAGE });
  }

  private isSameCachedAlias(document: vscode.TextDocument, offset: number): boolean {
    return isSameCachedAlias(
      this.focusCache,
      document.uri.toString(),
      document.version,
      offset,
    );
  }

  private invalidate(): void {
    this.generation.invalidate();
  }

  private isStale(generation: number): boolean {
    return this.disposed || !this.generation.isCurrent(generation);
  }
}

function isEligibleEditor(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
  if (editor === undefined) {
    return false;
  }
  const document = editor.document;
  return (
    (document.languageId === "typescript" || document.languageId === "typescriptreact") &&
    document.uri.scheme === "file" &&
    editor.selections.length === 1 &&
    editor.selection.isEmpty
  );
}
