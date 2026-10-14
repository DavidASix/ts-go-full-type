import * as vscode from "vscode";
import { UserVisibleError, errorMessage } from "../shared/errors";
import type { ResolvedCompleteType } from "../native/completeTypeProvider";
import type { FullTypeViewProvider } from "../sidebar/fullTypeViewProvider";
import { renderCompleteType } from "../sidebar/renderText";

export class ExpansionController {
  private session: ResolvedCompleteType | undefined;

  public constructor(private readonly view: Pick<FullTypeViewProvider, "setState" | "getState">) {}

  /**
   * Publish the replacement session before releasing the previous snapshot owner.
   * @param session Resolved type session and its snapshot ownership.
   */
  public async replace(session: ResolvedCompleteType | undefined): Promise<void> {
    const previous = this.session;
    this.session = session;
    if (session !== undefined) {
      this.render();
    }
    if (previous !== undefined && previous !== session) {
      await previous.dispose();
    }
  }

  public async toggle(viewNodeId: string): Promise<void> {
    await this.mutate(async (session) => session.graph.toggle(viewNodeId));
  }

  public async expandLevel(): Promise<void> {
    await this.mutate(async (session) => session.graph.expandFrontier());
  }

  public async collapseAll(): Promise<void> {
    await this.mutate(async (session) => session.graph.collapseAll());
  }

  /** Open the source declaration represented by a visible tree node. */
  public async goToDefinition(viewNodeId: string): Promise<void> {
    const session = this.session;
    if (session === undefined) return;
    try {
      const definition = await session.graph.getDefinition(viewNodeId);
      if (this.session !== session) return;
      if (definition === undefined) {
        void vscode.window.showInformationMessage("Full Type Viewer: No definition was found for this node.");
        return;
      }
      const start = new vscode.Position(definition.start.line, definition.start.character);
      const end = new vscode.Position(definition.end.line, definition.end.character);
      const uri = definition.fileName.startsWith("file:")
        ? vscode.Uri.parse(definition.fileName)
        : vscode.Uri.file(definition.fileName);
      await vscode.window.showTextDocument(uri, {
        preview: true,
        selection: new vscode.Range(start, end),
      });
    } catch (error) {
      if (this.session !== session) return;
      const message = errorMessage(error);
      void vscode.window.showErrorMessage(`Full Type Viewer: ${message}`);
    }
  }

  /**
   * Write the currently visible TypeScript representation to the clipboard.
   */
  public async copy(): Promise<string | undefined> {
    const state = this.view.getState();
    if (state.kind !== "success") {
      return undefined;
    }
    await vscode.env.clipboard.writeText(state.rawText);
    return state.rawText;
  }

  public current(): ResolvedCompleteType | undefined {
    return this.session;
  }

  public async dispose(): Promise<void> {
    await this.replace(undefined);
  }

  /**
   * Apply a graph operation and publish its result only while its session is still current.
   * @param operation Work to perform while the current owner remains valid.
   */
  private async mutate(operation: (session: ResolvedCompleteType) => Promise<void>): Promise<void> {
    const session = this.session;
    if (session === undefined) {
      return;
    }
    try {
      await operation(session);
      if (this.session === session) {
        this.render();
      }
    } catch (error) {
      if (this.session !== session) {
        return;
      }
      const message = errorMessage(error);
      const rawText = renderCompleteType(session.result);
      this.view.setState({ kind: "success", result: session.result, rawText, notice: message });
      if (!(error instanceof UserVisibleError)) {
        void vscode.window.showErrorMessage(`Full Type Viewer: ${message}`);
      }
    }
  }

  /**
   * Publish the current presentation to the sidebar.
   */
  private render(): void {
    const session = this.session;
    if (session === undefined) {
      return;
    }
    this.view.setState({
      kind: "success",
      result: session.result,
      rawText: renderCompleteType(session.result),
    });
  }
}
