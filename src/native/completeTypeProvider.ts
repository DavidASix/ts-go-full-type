import type * as vscode from "vscode";
import type { Project, Snapshot } from "typescript/unstable/async";
import type { SourceFile } from "typescript/unstable/ast";
import { UserVisibleError } from "../shared/errors";
import type { CompleteTypeResult } from "../shared/protocol";
import { findAliasFocus, type AliasFocus } from "./focus";
import { NativeConnection, type ConnectedAPI } from "./nativeConnection";
import { TypeGraph } from "./typeGraph";

export interface ResolveRequest {
  readonly document: vscode.TextDocument;
  readonly offset: number;
  readonly generation: number;
}

export interface ResolvedCompleteType {
  readonly result: CompleteTypeResult;
  readonly graph: TypeGraph;
  readonly focus: AliasFocus;
  dispose(): Promise<void>;
}

export class CompleteTypeProvider implements vscode.Disposable {
  private openedUri: string | undefined;
  private connectionGeneration = 0;
  private readonly snapshots = new Set<Snapshot>();

  public constructor(private readonly connection: NativeConnection) {}

  public async resolve(request: ResolveRequest): Promise<ResolvedCompleteType | undefined> {
    return this.connection.runWithReconnect(async (connected) => this.resolveConnected(connected, request));
  }

  public async disposeAsync(): Promise<void> {
    await Promise.all([...this.snapshots].map(async (snapshot) => snapshot.dispose()));
    this.snapshots.clear();
    this.openedUri = undefined;
  }

  public dispose(): void {
    void this.disposeAsync();
  }

  private async resolveConnected(
    connected: ConnectedAPI,
    request: ResolveRequest,
  ): Promise<ResolvedCompleteType | undefined> {
    if (this.connectionGeneration !== connected.generation) {
      await this.disposeAsync();
      this.connectionGeneration = connected.generation;
    }

    const uri = request.document.uri.toString();
    const changedFile = this.openedUri !== uri;
    let snapshot: Snapshot | undefined;
    try {
      let project: Project | undefined;
      let sourceFile: SourceFile | undefined;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        snapshot = await connected.api.updateSnapshot(changedFile && attempt === 0
          ? {
              openFiles: [{ uri }],
              ...(this.openedUri === undefined ? {} : { closeFiles: [{ uri: this.openedUri }] }),
            }
          : undefined);
        this.openedUri = uri;
        this.snapshots.add(snapshot);
        project = await snapshot.getDefaultProjectForFile({ uri });
        if (project === undefined) {
          throw new UserVisibleError("TypeScript 7 could not find a configured or inferred project for this file.");
        }
        sourceFile = await project.program.getSourceFile({ uri });
        if (sourceFile === undefined) {
          throw new UserVisibleError("The active file is not part of the selected TypeScript project.");
        }
        if (sourceFile.text === request.document.getText()) {
          break;
        }
        await this.releaseSnapshot(snapshot);
        connected.api.clearSourceFileCache();
        snapshot = undefined;
        project = undefined;
        sourceFile = undefined;
        if (attempt < 49) {
          await delay(100);
        }
      }
      if (snapshot === undefined || project === undefined || sourceFile === undefined) {
        throw new UserVisibleError("TypeScript 7 has not synchronized this edit yet. Save or retry.");
      }
      const focus = findAliasFocus(sourceFile, request.offset);
      if (focus === undefined) {
        await this.releaseSnapshot(snapshot);
        return undefined;
      }
      const type = await project.checker.getTypeFromTypeNode(focus.declaration.type);
      if (type === undefined || type.isErrorType()) {
        throw new UserVisibleError("TypeScript 7 could not resolve a semantic type for this alias.");
      }

      const graph = new TypeGraph(project.checker, focus.declaration, request.generation);
      const root = await graph.createRoot(type);
      const result: CompleteTypeResult = {
        name: focus.name,
        root,
        compilerVersion: "7.0.2",
        sourceUri: uri,
        project: project.configFileName,
        generation: request.generation,
      };
      let disposed = false;
      return {
        result,
        graph,
        focus,
        dispose: async () => {
          if (disposed) {
            return;
          }
          disposed = true;
          graph.clear();
          await this.releaseSnapshot(snapshot!);
        },
      };
    } catch (error) {
      if (snapshot !== undefined) {
        await this.releaseSnapshot(snapshot);
      }
      throw error;
    }
  }

  private async releaseSnapshot(snapshot: Snapshot): Promise<void> {
    if (!this.snapshots.delete(snapshot) || snapshot.isDisposed()) {
      return;
    }
    await snapshot.dispose();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
