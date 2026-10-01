import * as vscode from "vscode";
import { API } from "typescript/unstable/async";
import { UserVisibleError, isLikelyConnectionError } from "../shared/errors";
import {
  activateNativeExtension,
  type NativePreviewExtensionAPI,
} from "./nativeExtension";

export interface ConnectedAPI {
  readonly api: API<true>;
  readonly generation: number;
}

interface ReadyWaiter {
  readonly afterEpoch: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class NativeConnection implements vscode.Disposable {
  private nativeAPI: NativePreviewExtensionAPI | undefined;
  private nativeSubscription: vscode.Disposable | undefined;
  private client: API<true> | undefined;
  private clientGeneration = 0;
  private serverEpoch = 0;
  private disposed = false;
  private connecting: Promise<ConnectedAPI> | undefined;
  private readonly waiters = new Set<ReadyWaiter>();

  public async get(): Promise<ConnectedAPI> {
    if (this.disposed) {
      throw new UserVisibleError("Full Type Viewer has been disposed.");
    }
    if (this.client !== undefined) {
      return { api: this.client, generation: this.clientGeneration };
    }
    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  public async runWithReconnect<T>(operation: (connection: ConnectedAPI) => Promise<T>): Promise<T> {
    const initial = await this.get();
    const initialEpoch = this.serverEpoch;
    try {
      return await operation(initial);
    } catch (error) {
      if (!isLikelyConnectionError(error)) {
        throw error;
      }
      await this.resetClient();
      await this.waitForReadyAfter(initialEpoch);
      const replacement = await this.get();
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

  public async disposeAsync(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new UserVisibleError("Full Type Viewer was disposed."));
    }
    this.waiters.clear();
    this.nativeSubscription?.dispose();
    this.nativeSubscription = undefined;
    await this.resetClient();
  }

  public dispose(): void {
    void this.disposeAsync();
  }

  private async connect(): Promise<ConnectedAPI> {
    await this.ensureNativeAPI();
    await this.waitUntilReady();
    const pipe = await this.nativeAPI!.initializeAPIConnection();
    if (typeof pipe !== "string" || pipe.length === 0) {
      throw new UserVisibleError("TypeScript 7 did not return an API pipe. Ensure js/ts.experimental.useTsgo is enabled.");
    }
    try {
      this.client = await API.fromLSPConnection({ pipe });
    } catch (error) {
      throw new UserVisibleError("Could not connect to the TypeScript 7 API pipe. Restart the TypeScript language server and retry.", { cause: error });
    }
    this.clientGeneration += 1;
    return { api: this.client, generation: this.clientGeneration };
  }

  private async ensureNativeAPI(): Promise<void> {
    if (this.nativeAPI !== undefined) {
      return;
    }
    const enabled = vscode.workspace.getConfiguration().get<boolean>("js/ts.experimental.useTsgo");
    if (enabled === false) {
      throw new UserVisibleError("Enable js/ts.experimental.useTsgo to use the TypeScript 7 native server.");
    }
    this.nativeAPI = await activateNativeExtension();
    this.nativeSubscription = this.nativeAPI.onLanguageServerInitialized(() => {
      this.serverEpoch += 1;
      this.resolveReadyWaiters();
      if (this.client !== undefined) {
        void this.resetClient();
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

  private async resetClient(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client !== undefined) {
      try {
        await client.close();
      } catch {
        // The socket is commonly already gone after a native-server restart.
      }
    }
  }
}
