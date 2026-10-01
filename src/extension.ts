import * as vscode from "vscode";
import { ExpansionController } from "./controller/expansionController";
import { FocusController } from "./controller/focusController";
import { CompleteTypeProvider } from "./native/completeTypeProvider";
import { NativeConnection } from "./native/nativeConnection";
import { FullTypeViewProvider, VIEW_ID } from "./sidebar/fullTypeViewProvider";
import type { ViewState } from "./shared/protocol";

interface Runtime {
  readonly focus: FocusController;
  readonly expansion: ExpansionController;
  readonly provider: CompleteTypeProvider;
  readonly connection: NativeConnection;
  readonly view: FullTypeViewProvider;
}

let runtime: Runtime | undefined;

export interface FullTypeViewerTestingAPI {
  getViewState(): ViewState;
  toggle(viewNodeId: string): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): FullTypeViewerTestingAPI {
  const connection = new NativeConnection();
  const provider = new CompleteTypeProvider(connection);
  let focus: FocusController;
  let expansion: ExpansionController;
  const view = new FullTypeViewProvider(context.extensionUri, {
    onVisibilityChanged: (visible) => focus.onVisibilityChanged(visible),
    onToggle: (viewNodeId) => void expansion.toggle(viewNodeId),
  });
  expansion = new ExpansionController(view);
  focus = new FocusController(provider, expansion, view);
  runtime = { focus, expansion, provider, connection, view };

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
  );
  return {
    getViewState: () => view.getState(),
    toggle: async (viewNodeId) => expansion.toggle(viewNodeId),
  };
}

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
