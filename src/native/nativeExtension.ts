import * as vscode from "vscode";
import { UserVisibleError } from "../shared/errors";
import { isRecord } from "../shared/records";

export const NATIVE_EXTENSION_ID = "TypeScriptTeam.native-preview";

export interface NativePreviewExtensionAPI {
  readonly onLanguageServerInitialized: vscode.Event<void>;
  initializeAPIConnection(pipe?: string): Promise<string>;
  registerContentMappers(
    contributorId: string,
    contributions: readonly unknown[],
  ): vscode.Disposable;
}

/**
 * Validate the native extension export before relying on its lifecycle API.
 * @param value Untrusted value to validate or normalize.
 */
export function validateNativePreviewAPI(value: unknown): NativePreviewExtensionAPI | undefined {
  if (
    !isRecord(value) ||
    typeof value.onLanguageServerInitialized !== "function" ||
    typeof value.initializeAPIConnection !== "function" ||
    typeof value.registerContentMappers !== "function"
  ) {
    return undefined;
  }
  return value as unknown as NativePreviewExtensionAPI;
}

/**
 * Activate the pinned native extension and reject incompatible API exports.
 */
export async function activateNativeExtension(): Promise<NativePreviewExtensionAPI> {
  const extension = vscode.extensions.getExtension<unknown>(NATIVE_EXTENSION_ID);
  if (extension === undefined) {
    throw new UserVisibleError("Install TypeScriptTeam.native-preview 1.0.1 to use Full Type Viewer.");
  }
  const exported = await extension.activate();
  const api = validateNativePreviewAPI(exported);
  if (api === undefined) {
    throw new UserVisibleError("The installed TypeScript 7 extension does not expose the expected API. Install version 1.0.1.");
  }
  return api;
}
