import { describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({}));
import type { API } from "typescript/unstable/async";
import { NativeConnection } from "../src/native/nativeConnection";
import type { NativePreviewExtensionAPI } from "../src/native/nativeExtension";
import { deferred } from "./support/deferred";

function setup(connect = vi.fn(async () => client())) {
  let initialized!: () => void;
  const unsubscribe = vi.fn();
  const native = {
    onLanguageServerInitialized: (callback: () => void) => {
      initialized = callback;
      callback();
      return { dispose: unsubscribe };
    },
    initializeAPIConnection: vi.fn(async () => "/test-pipe"),
  } as unknown as NativePreviewExtensionAPI;
  const connection = new NativeConnection({ activate: async () => native, connect });
  return { connection, restart: () => initialized(), connect, unsubscribe };
}
function client() {
  return { close: vi.fn(async () => undefined) } as unknown as API<true>;
}

describe("native connection ownership", () => {
  it("closes a late handshake and rejects its result after shutdown", async () => {
    const handshake = deferred<API<true>>();
    const started = deferred<void>();
    const { connection, unsubscribe } = setup(vi.fn(() => {
      started.resolve();
      return handshake.promise;
    }));
    const getting = connection.get();
    const rejected = expect(getting).rejects.toThrow("disposed");
    await started.promise;
    const disposing = connection.disposeAsync();
    const late = client();
    handshake.resolve(late);
    await Promise.all([rejected, disposing]);
    expect(late.close).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    await connection.disposeAsync();
    expect(late.close).toHaveBeenCalledOnce();
  });

  it("invalidates sessions on restart and reconnects with a new generation", async () => {
    const { connection, restart } = setup();
    const invalidated = vi.fn();
    connection.onDidInvalidate(invalidated);
    const first = await connection.get();
    restart();
    expect(connection.isCurrent(first)).toBe(false);
    expect(invalidated).toHaveBeenCalledOnce();
    const second = await connection.get();
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(connection.isCurrent(second)).toBe(true);
    await connection.disposeAsync();
    expect(first.api.close).toHaveBeenCalledOnce();
    expect(second.api.close).toHaveBeenCalledOnce();
  });

  it("never publishes a handshake from the previous server epoch", async () => {
    const handshake = deferred<API<true>>();
    const started = deferred<void>();
    const { connection, restart } = setup(vi.fn(() => {
      started.resolve();
      return handshake.promise;
    }));
    const getting = connection.get();
    const rejected = expect(getting).rejects.toThrow("restarted");
    await started.promise;
    restart();
    const late = client();
    handshake.resolve(late);
    await rejected;
    expect(late.close).toHaveBeenCalledOnce();
    await connection.disposeAsync();
  });
});
