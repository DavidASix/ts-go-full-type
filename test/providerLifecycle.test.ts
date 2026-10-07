import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({}));
import type { API, Project, Snapshot, Type } from "typescript/unstable/async";
import type { SourceFile } from "typescript/unstable/ast";
import { NativeConnection } from "../src/native/nativeConnection";
import type { NativePreviewExtensionAPI } from "../src/native/nativeExtension";
import { CompleteTypeProvider, type ResolveRequest } from "../src/native/completeTypeProvider";
import * as focusModule from "../src/native/focus";
import type { Node, TypeNode } from "typescript/unstable/ast";
import { deferred } from "./support/deferred";

function request(uri = "file:///a.ts", signal = new AbortController().signal): ResolveRequest {
  return { uri, text: "wanted text", version: 1, offset: 0, generation: 1, signal };
}
function snapshot(text = "outdated text") {
  const source = { text } as SourceFile;
  const project = { program: { getSourceFile: vi.fn(async () => source) } } as unknown as Project;
  const disposed = vi.fn(async () => undefined);
  return { value: { getDefaultProjectForFile: vi.fn(async () => project), isDisposed: () => disposed.mock.calls.length > 0, dispose: disposed } as unknown as Snapshot, disposed, project };
}
function setup(updateSnapshot: API<true>["updateSnapshot"]) {
  const api = { updateSnapshot, clearSourceFileCache: vi.fn(), close: vi.fn(async () => undefined) } as unknown as API<true>;
  const native = { onLanguageServerInitialized: (callback: () => void) => { callback(); return { dispose() {} }; }, initializeAPIConnection: async () => "/pipe" } as unknown as NativePreviewExtensionAPI;
  const connection = new NativeConnection({ activate: async () => native, connect: async () => api });
  return { provider: new CompleteTypeProvider(connection), connection, api };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("serialized resolution ownership", () => {
  it("releases a late snapshot and skips its semantic requests after cancellation", async () => {
    const started = deferred<void>();
    const response = deferred<Snapshot>();
    const old = snapshot();
    const update = vi.fn(async () => { started.resolve(); return response.promise; });
    const { provider, connection } = setup(update);
    const cancellation = new AbortController();
    const resolving = provider.resolve(request(undefined, cancellation.signal));
    const rejected = expect(resolving).rejects.toThrow("superseded");
    await started.promise;
    cancellation.abort();
    response.resolve(old.value);
    await rejected;
    expect(old.disposed).toHaveBeenCalledOnce();
    expect(old.value.getDefaultProjectForFile).not.toHaveBeenCalled();
    await provider.disposeAsync();
    await connection.disposeAsync();
  });

  it("a newer file waits for old snapshot bookkeeping and closes the correct file", async () => {
    const started = deferred<void>();
    const response = deferred<Snapshot>();
    const old = snapshot();
    const latest = snapshot("");
    const update = vi.fn<API<true>["updateSnapshot"]>()
      .mockImplementationOnce(async () => { started.resolve(); return response.promise; })
      .mockResolvedValueOnce(latest.value);
    const { provider, connection } = setup(update);
    const first = provider.resolve(request());
    const rejected = expect(first).rejects.toThrow("superseded");
    await started.promise;
    const second = provider.resolve({ ...request("file:///b.ts"), text: "" });
    expect(update).toHaveBeenCalledOnce();
    response.resolve(old.value);
    await rejected;
    await expect(second).resolves.toBeUndefined();
    expect(update.mock.calls[1]?.[0]).toEqual({ openFiles: [{ uri: "file:///b.ts" }], closeFiles: [{ uri: "file:///a.ts" }] });
    expect(old.disposed).toHaveBeenCalledOnce();
    expect(latest.disposed).toHaveBeenCalledOnce();
    await provider.disposeAsync();
    await connection.disposeAsync();
  });

  it("shutdown cancels synchronization sleep without issuing another snapshot request", async () => {
    vi.useFakeTimers();
    const old = snapshot();
    const update = vi.fn(async () => old.value);
    const { provider, connection, api } = setup(update);
    const resolving = provider.resolve(request());
    const rejected = expect(resolving).rejects.toThrow("superseded");
    await vi.waitFor(() => expect(api.clearSourceFileCache).toHaveBeenCalledOnce());
    await provider.disposeAsync();
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(update).toHaveBeenCalledOnce();
    await connection.disposeAsync();
  });
  it("keeps the displayed snapshot alive independently of the completed focus request", async () => {
    const nativeType = {
      id: 1, getAliasSymbol: async () => undefined,
      isUnionType: () => false, isIntersectionType: () => false, isIndexedAccessType: () => false,
      isIndexType: () => false, isConditionalType: () => false, isSubstitutionType: () => false,
      isTemplateLiteralType: () => false, isStringMappingType: () => false,
      isTypeParameter: () => false, isObjectType: () => false, isErrorType: () => false,
    } as unknown as Type;
    const loaded = snapshot("wanted text");
    Object.assign(loaded.project, { configFileName: "/tsconfig.json", checker: {
      getTypeFromTypeNode: async () => nativeType, typeToString: async () => "string",
    } });
    vi.spyOn(focusModule, "findSymbolFocus").mockReturnValue({ name: "Example", start: 0, end: 7, node: {} as Node, typeNode: {} as TypeNode });
    const { provider, connection } = setup(vi.fn(async () => loaded.value));
    const scope = new AbortController();
    const current = await provider.resolve(request(undefined, scope.signal));
    expect(current?.result.root.text).toBe("string");
    expect(loaded.disposed).not.toHaveBeenCalled();
    scope.abort();
    await current!.graph.collapseAll();
    expect(loaded.disposed).not.toHaveBeenCalled();
    await Promise.all([current!.dispose(), provider.disposeAsync()]);
    expect(loaded.disposed).toHaveBeenCalledOnce();
    await connection.disposeAsync();
  });

});
