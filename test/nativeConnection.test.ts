import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({}));
import type { API } from "typescript/unstable/async";
import { NativeConnection } from "../src/native/nativeConnection";
import type { NativePreviewExtensionAPI } from "../src/native/nativeExtension";
import { deferred } from "./support/deferred";

function setup(connect = vi.fn(async () => client()), ready = true) {
  let initialized!: () => void;
  const unsubscribe = vi.fn();
  const native = {
    onLanguageServerInitialized: (callback: () => void) => {
      initialized = callback;
      if (ready) callback();
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

afterEach(() => vi.useRealTimers());

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

  it("retries an interrupted handshake without publishing the previous server's client", async () => {
    const handshake = deferred<API<true>>();
    const started = deferred<void>();
    const replacement = client();
    const connect = vi.fn(async () => replacement).mockImplementationOnce(() => {
      started.resolve(); return handshake.promise;
    });
    const { connection, restart } = setup(connect);
    const getting = connection.get();
    await started.promise;
    restart();
    const late = client();
    handshake.resolve(late);
    const current = await getting;
    expect(current.api).toBe(replacement);
    expect(late.close).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(2);
    await connection.disposeAsync();
  });

  it("limits handshake retries when the server keeps restarting", async () => {
    const clients: API<true>[] = [];
    let restart!: () => void;
    const connect = vi.fn(async () => {
      restart(); const next = client(); clients.push(next); return next;
    });
    const h = setup(connect); restart = h.restart;
    await expect(h.connection.get()).rejects.toThrow("restarted while connecting");
    expect(connect).toHaveBeenCalledTimes(2);
    for (const next of clients) expect(next.close).toHaveBeenCalledOnce();
    await h.connection.disposeAsync();
  });

  it("shares a single handshake across concurrent requests", async () => {
    const h = setup();
    const connections = await Promise.all([h.connection.get(), h.connection.get()]);
    expect(connections[0].api).toBe(connections[1].api);
    expect(h.connect).toHaveBeenCalledOnce();
    await h.connection.disposeAsync();
    await expect(h.connection.get()).rejects.toThrow("disposed");
  });

  it("retries a failed operation once after server initialization, then stops", async () => {
    const h = setup();
    const operation = vi.fn(async () => {
      h.restart();
      throw new Error("socket closed");
    });
    await expect(h.connection.runWithReconnect(operation)).rejects.toThrow("restarted during the request");
    expect(operation).toHaveBeenCalledTimes(2);
    await h.connection.disposeAsync();
  });

  it("does not replay semantic failures or canceled work", async () => {
    const h = setup();
    const operation = vi.fn(async () => { throw new Error("invalid semantic type"); });
    await expect(h.connection.runWithReconnect(operation)).rejects.toThrow("invalid semantic type");
    expect(operation).toHaveBeenCalledOnce();
    const scope = new AbortController(); scope.abort();
    await expect(h.connection.runWithReconnect(operation, scope.signal)).rejects.toThrow("superseded");
    expect(operation).toHaveBeenCalledOnce();
    await h.connection.disposeAsync();
  });

  it("times out initialization with an actionable error instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    const h = setup(undefined, false);
    const rejected = expect(h.connection.get()).rejects.toThrow("15 seconds");
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(h.connect).not.toHaveBeenCalled();
    await h.connection.disposeAsync();
  });

});
