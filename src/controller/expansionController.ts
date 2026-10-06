import * as vscode from "vscode";
import { UserVisibleError, errorMessage } from "../shared/errors";
import type { ResolvedCompleteType } from "../native/completeTypeProvider";
import { FullTypeViewProvider } from "../sidebar/fullTypeViewProvider";
import { renderCompleteType } from "../sidebar/renderText";

export class ExpansionController {
  private session: ResolvedCompleteType | undefined;

  public constructor(private readonly view: FullTypeViewProvider) {}

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
