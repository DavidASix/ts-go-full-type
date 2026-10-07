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
}

export class FullTypeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private state: ViewState = { kind: "idle", message: "Place the cursor on a TypeScript symbol." };
  private palette: ThemeTokenPalette = {};
  private paletteRequest = 0;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly viewDisposables: vscode.Disposable[] = [];
  private ready = false;

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
      cspSource: view.webview.cspSource,
      scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")),
      nonce, palette: this.palette, wordWrap: this.wordWrap,
    });
    this.events.onVisibilityChanged(view.visible);
  }

  public setState(state: ViewState): void {
    this.state = state;
    this.render();
  }

  public getState(): ViewState {
    return this.state;
  }

  public setWordWrap(enabled: boolean): void {
    if (enabled === this.wordWrap) {
      return;
    }
    this.wordWrap = enabled;
    this.render();
  }

  public dispose(): void {
    this.paletteRequest += 1;
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.releaseView();
  }

  private releaseView(): void {
    this.ready = false;
    for (const disposable of this.viewDisposables.splice(0)) disposable.dispose();
    this.view = undefined;
  }

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
