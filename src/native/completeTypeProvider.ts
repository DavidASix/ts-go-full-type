import type * as vscode from "vscode";
import {
  SymbolFlags,
  type Checker,
  type Project,
  type Snapshot,
  type Symbol as AsyncSymbol,
  type Type,
} from "typescript/unstable/async";
import type { SourceFile } from "typescript/unstable/ast";
import { assertRequestActive, RequestCancelledError, waitForRetry } from "../shared/cancellation";
import { UserVisibleError, isLikelyConnectionError } from "../shared/errors";
import type { CompleteTypeResult } from "../shared/protocol";
import { findSymbolFocus, type SymbolFocus } from "./focus";
import { NativeConnection, type ConnectedAPI } from "./nativeConnection";
import { TypeGraph } from "./typeGraph";

export interface ResolveRequest {
  readonly uri: string;
  readonly text: string;
  readonly version: number;
  readonly signal: AbortSignal;
  readonly offset: number;
  readonly generation: number;
}

export interface ResolvedCompleteType {
  readonly result: CompleteTypeResult;
  readonly graph: TypeGraph;
  readonly focus: SymbolFocus;
  dispose(): Promise<void>;
}

export class CompleteTypeProvider implements vscode.Disposable {
  private openedUri: string | undefined;
  private connectionGeneration = 0;
  private readonly snapshots = new Set<Snapshot>();
  private readonly sessions = new Set<ResolvedCompleteType>();
  private readonly invalidationListeners = new Set<() => void>();
  private readonly requests = new Set<AbortController>();
  private pending: Promise<void> = Promise.resolve();
  private disposed = false;
  private disposal: Promise<void> | undefined;
  private readonly connectionSubscription: vscode.Disposable;

  /**
   * Initialize ownership and event subscriptions for this component.
   * @param connection Native client and server lifecycle owner.
   */
  public constructor(private readonly connection: NativeConnection) {
    this.connectionSubscription = connection.onDidInvalidate(() => {
      this.cancelRequests();
      const draining = this.pending;
      const disposals = [...this.sessions].map((session) => session.dispose());
      this.openedUri = undefined;
      for (const listener of this.invalidationListeners) listener();
      // Capture the old queue before listeners can schedule replacement requests.
      return Promise.all([draining, ...disposals]).then(() => undefined);
    });
  }

  /**
   * Subscribe to invalidation and return a disposable that removes the listener.
   * @param listener Callback invoked when the current native state becomes invalid.
   */
  public onDidInvalidate(listener: () => void): vscode.Disposable {
    this.invalidationListeners.add(listener);
    return { dispose: () => { this.invalidationListeners.delete(listener); } };
  }

  /**
   * Resolve the captured request and discard results superseded by newer focus.
   * @param request Captured editor text, focus, generation, and cancellation scope.
   */
  public resolve(request: ResolveRequest): Promise<ResolvedCompleteType | undefined> {
    if (this.disposed) return Promise.reject(new RequestCancelledError());
    this.cancelRequests();
    const scope = new AbortController();
    const cancel = () => scope.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) cancel();
    this.requests.add(scope);
    const captured = { ...request, signal: scope.signal };
    // File-open state and the API source cache belong to one serialized owner.
    const result = this.pending.then(async () => {
      assertRequestActive(scope.signal);
      return this.connection.runWithReconnect(
        async (connected) => this.resolveConnected(connected, captured), scope.signal,
      );
    }).finally(() => {
      request.signal.removeEventListener("abort", cancel);
      this.requests.delete(scope);
    });
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  public disposeAsync(): Promise<void> {
    return this.disposal ??= this.shutdown();
  }

  /**
   * Cancel requests and drain outstanding ownership before releasing resources.
   */
  private async shutdown(): Promise<void> {
    this.disposed = true;
    this.connectionSubscription.dispose();
    this.cancelRequests();
    await this.pending;
    await Promise.all([...this.sessions].map((session) => session.dispose()));
    await Promise.all([...this.snapshots].map((snapshot) => this.releaseSnapshot(snapshot)));
    this.invalidationListeners.clear();
    this.openedUri = undefined;
  }

  public dispose(): void { void this.disposeAsync(); }

  private cancelRequests(): void {
    for (const request of this.requests) request.abort();
  }

  /**
   * Synchronize editor text with the native project and create a snapshot-owned graph session.
   * @param connected Native API client and its connection generation.
   * @param request Captured editor text, focus, generation, and cancellation scope.
   */
  private async resolveConnected(
    connected: ConnectedAPI,
    request: ResolveRequest,
  ): Promise<ResolvedCompleteType | undefined> {
    /**
     * Reject work after cancellation or a native connection generation change.
     */
    const check = () => {
      assertRequestActive(request.signal);
      if (!this.connection.isCurrent(connected)) throw new RequestCancelledError();
    };
    /**
     * Check request validity before and after an awaited native query.
     * @param operation Work to perform while the current owner remains valid.
     */
    const query = async <T>(operation: () => Promise<T>): Promise<T> => {
      check();
      const value = await operation();
      check();
      return value;
    };
    check();
    if (this.connectionGeneration !== connected.generation) {
      this.openedUri = undefined;
      this.connectionGeneration = connected.generation;
    }
    const uri = request.uri;
    let snapshot: Snapshot | undefined;
    try {
      let project: Project | undefined;
      let sourceFile: SourceFile | undefined;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        check();
        const changedFile = this.openedUri !== uri;
        snapshot = await connected.api.updateSnapshot(changedFile
          ? { openFiles: [{ uri }], ...(this.openedUri === undefined ? {} : { closeFiles: [{ uri: this.openedUri }] }) }
          : undefined);
        // Even a late response is owned and released before cancellation escapes.
        this.snapshots.add(snapshot);
        this.openedUri = uri;
        check();
        project = await query(() => snapshot!.getDefaultProjectForFile({ uri }));
        if (project === undefined) throw new UserVisibleError("TypeScript 7 could not find a configured or inferred project for this file.");
        sourceFile = await query(() => project!.program.getSourceFile({ uri }));
        if (sourceFile === undefined) throw new UserVisibleError("The active file is not part of the selected TypeScript project.");
        if (sourceFile.text === request.text) break;
        await this.releaseSnapshot(snapshot);
        check();
        connected.api.clearSourceFileCache();
        snapshot = undefined;
        project = undefined;
        sourceFile = undefined;
        if (attempt < 49) await waitForRetry(100, request.signal);
      }
      if (snapshot === undefined || project === undefined || sourceFile === undefined) {
        throw new UserVisibleError("TypeScript 7 has not synchronized this edit yet. Save or retry.");
      }
      const focus = findSymbolFocus(sourceFile, request.offset);
      if (focus === undefined) { await this.releaseSnapshot(snapshot); return undefined; }
      const type = await query(() => resolveFocusedType(project!.checker, uri, focus, check));
      if (type === undefined) { await this.releaseSnapshot(snapshot); return undefined; }
      if (type.isErrorType()) throw new UserVisibleError("TypeScript 7 could not resolve a semantic type for this symbol.");
      const selectedSymbol = await query(() => project!.checker.getSymbolAtLocation(focus.node));
      const rootSymbol = selectedSymbol !== undefined && selectedSymbol.flags & SymbolFlags.Alias
        ? await query(() => project!.checker.getAliasedSymbol(selectedSymbol))
        : selectedSymbol;
      let published = false;
      const graph = new TypeGraph(project, focus.node, request.generation, () => {
        if (!published) check();
        else if (!this.connection.isCurrent(connected)) throw new RequestCancelledError();
      });
      const root = await graph.createRoot(type, rootSymbol);
      check();
      const result: CompleteTypeResult = {
        name: focus.name, root, compilerVersion: "7.0.2", sourceUri: uri,
        project: project.configFileName, generation: request.generation,
      };
      let disposal: Promise<void> | undefined;
      const session: ResolvedCompleteType = {
        result, graph, focus,
        dispose: () => disposal ??= (async () => {
          await graph.disposeAsync();
          await this.releaseSnapshot(snapshot!);
          this.sessions.delete(session);
        })(),
      };
      published = true;
      this.sessions.add(session);
      return session;
    } catch (error) {
      if (snapshot !== undefined) await this.releaseSnapshot(snapshot);
      throw error;
    }
  }

  /**
   * Dispose an owned snapshot once, tolerating errors from a lost connection.
   * @param snapshot Owned snapshot to release after dependent work drains.
   */
  private async releaseSnapshot(snapshot: Snapshot): Promise<void> {
    if (!this.snapshots.delete(snapshot) || snapshot.isDisposed()) return;
    try { await snapshot.dispose(); }
    catch (error) { if (!isLikelyConnectionError(error)) throw error; }
  }
}

/**
 * Prefer the focused type syntax, then recover through positional and symbol queries.
 * @param checker Native semantic query API for the selected project.
 * @param uri Source or theme resource URI.
 * @param focus Identifier range and any directly associated type syntax.
 * @param checkActive Guard invoked between queries to reject obsolete work.
 */
export async function resolveFocusedType(
  checker: Checker,
  uri: string,
  focus: SymbolFocus,
  checkActive: () => void = () => {},
): Promise<Type | undefined> {
  checkActive();
  if (focus.typeNode !== undefined) {
    return checker.getTypeFromTypeNode(focus.typeNode);
  }
  const positionalType = await checker.getTypeAtPosition({ uri }, focus.start);
  checkActive();
  if (positionalType !== undefined && !positionalType.isErrorType()) {
    return positionalType;
  }
  const locationType = await checker.getTypeAtLocation(focus.node);
  checkActive();
  if (locationType !== undefined && !locationType.isErrorType()) {
    return locationType;
  }
  const symbol = await checker.getSymbolAtLocation(focus.node);
  checkActive();
  if (symbol === undefined) {
    return locationType ?? positionalType;
  }
  const symbolType = await resolveSymbolType(checker, symbol, focus, checkActive);
  return symbolType ?? locationType ?? positionalType;
}

/**
 * Follow import aliases and resolve the selected symbol in its declaration context.
 * @param checker Native semantic query API for the selected project.
 * @param selectedSymbol Compiler symbol selected at the focused identifier.
 * @param focus Identifier range and any directly associated type syntax.
 * @param checkActive Guard invoked between queries to reject obsolete work.
 */
async function resolveSymbolType(
  checker: Checker,
  selectedSymbol: AsyncSymbol,
  focus: SymbolFocus,
  checkActive: () => void = () => {},
): Promise<Type | undefined> {
  checkActive();
  const symbol = selectedSymbol.flags & SymbolFlags.Alias
    ? await checker.getAliasedSymbol(selectedSymbol)
    : selectedSymbol;
  checkActive();
  const type = symbol.flags & SymbolFlags.Type
    ? await checker.getDeclaredTypeOfSymbol(symbol)
    : await checker.getTypeOfSymbolAtLocation(symbol, focus.node);
  return type.isErrorType() ? undefined : type;
}
