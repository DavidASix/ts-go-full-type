import * as vscode from "vscode";
import { ExpansionController } from "./controller/expansionController";
import { FocusController } from "./controller/focusController";
import { CompleteTypeProvider } from "./native/completeTypeProvider";
import { NativeConnection } from "./native/nativeConnection";
import { FullTypeViewProvider, VIEW_ID } from "./sidebar/fullTypeViewProvider";

interface Runtime {
  readonly focus: FocusController;
  readonly expansion: ExpansionController;
  readonly provider: CompleteTypeProvider;
  readonly connection: NativeConnection;
  readonly view: FullTypeViewProvider;
}

const WORD_WRAP_KEY = "fullTypeViewer.wordWrap";

let runtime: Runtime | undefined;

/**
 * Register the sidebar, editor tracking, and contributed commands for this extension session.
 * @param context VS Code extension context that owns subscriptions and persisted preferences.
 */
export function activate(context: vscode.ExtensionContext): void {
  const connection = new NativeConnection();
  const provider = new CompleteTypeProvider(connection);
  let focus: FocusController;
  let expansion: ExpansionController;
  const wordWrap = context.workspaceState.get<boolean>(WORD_WRAP_KEY, false);
  const view = new FullTypeViewProvider(context.extensionUri, {
    onVisibilityChanged: (visible) => focus.onVisibilityChanged(visible),
    onToggle: (viewNodeId) => void expansion.toggle(viewNodeId),
    onGoToDefinition: (viewNodeId, target) => void expansion.goToDefinition(viewNodeId, target),
  }, wordWrap);
  expansion = new ExpansionController(view);
  focus = new FocusController(provider, expansion, view);
  runtime = { focus, expansion, provider, connection, view };

  /**
   * Persist the wrapping preference and update the view and command context together.
   * @param enabled Whether long type rows should wrap.
   */
  const setWordWrap = async (enabled: boolean): Promise<void> => {
    view.setWordWrap(enabled);
    await Promise.all([
      context.workspaceState.update(WORD_WRAP_KEY, enabled),
      vscode.commands.executeCommand("setContext", WORD_WRAP_KEY, enabled),
    ]);
  };
  void vscode.commands.executeCommand("setContext", WORD_WRAP_KEY, wordWrap);

  context.subscriptions.push(
    view,
    focus,
    vscode.window.registerWebviewViewProvider(VIEW_ID, view, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
    vscode.commands.registerCommand("fullTypeViewer.refresh", () => focus.refresh()),
    vscode.commands.registerCommand("fullTypeViewer.expandLevel", () => expansion.expandLevel()),
    vscode.commands.registerCommand("fullTypeViewer.collapseAll", () => expansion.collapseAll()),
    vscode.commands.registerCommand("fullTypeViewer.copy", () => expansion.copy()),
    vscode.commands.registerCommand("fullTypeViewer.enableWordWrap", () => setWordWrap(true)),
    vscode.commands.registerCommand("fullTypeViewer.disableWordWrap", () => setWordWrap(false)),
  );

}

/**
 * Drain graph and connection work before releasing the extension runtime.
 */
export async function deactivate(): Promise<void> {
  const current = runtime;
  runtime = undefined;
  if (current === undefined) {
    return;
  }
  current.focus.dispose();
  await current.expansion.dispose();
  await current.provider.disposeAsync();
  await current.connection.disposeAsync();
  current.view.dispose();
}
