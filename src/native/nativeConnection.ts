import * as vscode from "vscode";
import { API } from "typescript/unstable/async";
import { assertRequestActive, awaitWhileActive } from "../shared/cancellation";
import { UserVisibleError, isLikelyConnectionError } from "../shared/errors";
import {
  activateNativeExtension,
  type NativePreviewExtensionAPI,
} from "./nativeExtension";

export interface ConnectedAPI {
  readonly api: API<true>;
  readonly generation: number;
}

export interface NativeConnectionDependencies {
  activate(): Promise<NativePreviewExtensionAPI>;
  connect(pipe: string): Promise<API<true>>;
}

const defaultDependencies: NativeConnectionDependencies = {
  activate: async () => {
    if (vscode.workspace.getConfiguration().get<boolean>("js/ts.experimental.useTsgo") === false) {
      throw new UserVisibleError("Enable js/ts.experimental.useTsgo to use the TypeScript 7 native server.");
    }
    return activateNativeExtension();
  },
  connect: async (pipe) => API.fromLSPConnection({ pipe }),
};

interface ReadyWaiter {
  readonly afterEpoch: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

class InterruptedHandshakeError extends UserVisibleError {}

export class NativeConnection implements vscode.Disposable {
  private nativeAPI: NativePreviewExtensionAPI | undefined;
  private nativeSubscription: vscode.Disposable | undefined;
  private client: API<true> | undefined;
  private clientGeneration = 0;
  private serverEpoch = 0;
  private disposed = false;
  private connecting: Promise<ConnectedAPI> | undefined;
  private readonly waiters = new Set<ReadyWaiter>();
  private readonly invalidationListeners = new Set<() => void | Promise<void>>();
  private closing: Promise<void> = Promise.resolve();
  private disposal: Promise<void> | undefined;

  public constructor(private readonly dependencies = defaultDependencies) {}

  public onDidInvalidate(listener: () => void | Promise<void>): vscode.Disposable {
    this.invalidationListeners.add(listener);
    return { dispose: () => { this.invalidationListeners.delete(listener); } };
  }

  public isCurrent(connection: ConnectedAPI): boolean {
    return !this.disposed && this.client === connection.api && this.clientGeneration === connection.generation;
  }

  public async get(): Promise<ConnectedAPI> {
    if (this.disposed) {
      throw new UserVisibleError("Full Type Viewer has been disposed.");
    }
    if (this.client !== undefined) {
      return { api: this.client, generation: this.clientGeneration };
    }
    this.connecting ??= this.connectWithRetry().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  public async runWithReconnect<T>(operation: (connection: ConnectedAPI) => Promise<T>, signal = new AbortController().signal): Promise<T> {
    assertRequestActive(signal);
    const initial = await awaitWhileActive(this.get(), signal);
    assertRequestActive(signal);
    const initialEpoch = this.serverEpoch;
    try {
      return await operation(initial);
    } catch (error) {
      assertRequestActive(signal);
      if (!isLikelyConnectionError(error)) {
        throw error;
      }
      if (this.isCurrent(initial)) {
        this.invalidateClient();
      }
      await awaitWhileActive(this.waitForReadyAfter(initialEpoch), signal);
      assertRequestActive(signal);
      const replacement = await awaitWhileActive(this.get(), signal);
      try {
        return await operation(replacement);
      } catch (retryError) {
        if (isLikelyConnectionError(retryError)) {
          throw new UserVisibleError("The TypeScript 7 server restarted during the request. Retry after it finishes initializing.", { cause: retryError });
        }
        throw retryError;
      }
    }
  }

  public disposeAsync(): Promise<void> {
    return this.disposal ??= this.shutdown();
  }

  private async shutdown(): Promise<void> {
    this.disposed = true;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new UserVisibleError("Full Type Viewer was disposed."));
    }
    this.waiters.clear();
    this.nativeSubscription?.dispose();
    this.nativeSubscription = undefined;
    this.invalidateClient();
    this.invalidationListeners.clear();
    await this.connecting?.catch(() => undefined);
    await this.closing;
  }

  public dispose(): void {
    void this.disposeAsync();
  }

  private async connectWithRetry(): Promise<ConnectedAPI> {
    try {
      return await this.connect();
    } catch (error) {
      if (!(error instanceof InterruptedHandshakeError)) throw error;
      // Concurrent callers share this retry, including the latest focused symbol.
      return this.connect();
    }
  }

  private async connect(): Promise<ConnectedAPI> {
    await this.ensureNativeAPI();
    this.assertAlive();
    await this.waitUntilReady();
    await this.closing;
    this.assertAlive();
    const epoch = this.serverEpoch;
    let client: API<true>;
    try {
      const pipe = await this.nativeAPI!.initializeAPIConnection();
      this.assertAlive();
      if (typeof pipe !== "string" || pipe.length === 0) {
        throw new UserVisibleError("TypeScript 7 did not return an API pipe. Ensure js/ts.experimental.useTsgo is enabled.");
      }
      client = await this.dependencies.connect(pipe);
    } catch (error) {
      this.assertAlive();
      if (epoch !== this.serverEpoch) {
        throw new InterruptedHandshakeError("The TypeScript 7 server restarted while connecting. Refresh the type and try again.", { cause: error });
      }
      if (error instanceof UserVisibleError) throw error;
      throw new UserVisibleError("Could not connect to the TypeScript 7 API pipe. Restart the TypeScript language server and retry.", { cause: error });
    }
    if (this.disposed || epoch !== this.serverEpoch) {
      await client.close().catch(() => undefined);
      this.assertAlive();
      throw new InterruptedHandshakeError("The TypeScript 7 server restarted while connecting. Refresh the type and try again.");
    }
    this.client = client;
    this.clientGeneration += 1;
    return { api: this.client, generation: this.clientGeneration };
  }

  private async ensureNativeAPI(): Promise<void> {
    if (this.nativeAPI !== undefined) {
      return;
    }
    this.nativeAPI = await this.dependencies.activate();
    this.assertAlive();
    this.nativeSubscription = this.nativeAPI.onLanguageServerInitialized(() => {
      this.serverEpoch += 1;
      this.resolveReadyWaiters();
      if (this.serverEpoch > 1) {
        this.invalidateClient();
      }
    });
  }

  private async waitUntilReady(): Promise<void> {
    if (this.serverEpoch > 0) {
      return;
    }
    await this.waitForReadyAfter(0, true);
  }

  private waitForReadyAfter(afterEpoch: number, allowCurrent = false): Promise<void> {
    this.assertAlive();
    if ((allowCurrent && this.serverEpoch > 0) || this.serverEpoch > afterEpoch) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: ReadyWaiter = {
        afterEpoch,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new UserVisibleError("TypeScript 7 did not initialize within 15 seconds. Check that js/ts.experimental.useTsgo is enabled."));
        }, 15_000),
      };
      this.waiters.add(waiter);
    });
  }

  private resolveReadyWaiters(): void {
    for (const waiter of this.waiters) {
      if (this.serverEpoch > waiter.afterEpoch) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve();
      }
    }
  }

  private assertAlive(): void {
    if (this.disposed) throw new UserVisibleError("Full Type Viewer has been disposed.");
  }

  private invalidateClient(): void {
    const client = this.client;
    this.client = undefined;
    const invalidations = [...this.invalidationListeners].map((listener) => listener());
    this.closing = this.closing.then(async () => {
      // Dispose sessions before API.close(), which itself disposes snapshots.
      await Promise.allSettled(invalidations);
      if (client !== undefined) {
        // The socket is commonly already gone after a native-server restart.
        await client.close().catch(() => undefined);
      }
    });
  }
}
