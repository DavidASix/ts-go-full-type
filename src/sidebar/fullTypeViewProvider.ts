import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { parseWebviewMessage, type ViewState } from "../shared/protocol";
import { renderHtml } from "./renderHtml";

export const VIEW_ID = "fullTypeViewer.type";

export interface FullTypeViewEvents {
  readonly onVisibilityChanged: (visible: boolean) => void;
  readonly onToggle: (viewNodeId: string) => void;
}

export class FullTypeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private state: ViewState = { kind: "idle", message: "Place the cursor on a type alias name." };
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly events: FullTypeViewEvents,
  ) {}

  public get visible(): boolean {
    return this.view?.visible === true;
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    this.disposables.push(
      view.onDidChangeVisibility(() => this.events.onVisibilityChanged(view.visible)),
      view.webview.onDidReceiveMessage((raw: unknown) => {
        const message = parseWebviewMessage(raw);
        if (message?.type === "toggle") {
          this.events.onToggle(message.viewNodeId);
        }
      }),
      view.onDidDispose(() => {
        this.view = undefined;
        this.events.onVisibilityChanged(false);
      }),
    );
    this.render();
    this.events.onVisibilityChanged(view.visible);
  }

  public setState(state: ViewState): void {
    this.state = state;
    this.render();
  }

  public getState(): ViewState {
    return this.state;
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.view = undefined;
  }

  private render(): void {
    const webview = this.view?.webview;
    if (webview === undefined) {
      return;
    }
    const nonce = randomBytes(18).toString("base64url");
    webview.html = renderHtml(this.state, {
      cspSource: webview.cspSource,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")),
      nonce,
    });
  }
}
