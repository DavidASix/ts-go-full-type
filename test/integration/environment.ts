import { access, readFile, readdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const NATIVE_VERSION = "1.0.1";

async function isExecutable(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

/**
 * Locate and validate the installed VS Code and pinned native extension for integration tests.
 * @param env Environment overrides for executable and fixture discovery.
 */
export async function resolveIntegrationEnvironment(env: NodeJS.ProcessEnv = process.env) {
  let vscodeExecutable = env.FULL_TYPE_VIEWER_VSCODE;
  if (vscodeExecutable === undefined) {
    for (const directory of (env.PATH ?? "").split(":")) {
      const launcher = join(directory, "code-insiders");
      if (!await isExecutable(launcher)) continue;
      const installed = await realpath(launcher);
      const binary = resolve(dirname(installed), "..", "code-insiders");
      vscodeExecutable = await isExecutable(binary) ? binary : installed;
      break;
    }
  }
  if (vscodeExecutable === undefined || !await isExecutable(vscodeExecutable)) {
    throw new Error("Install VS Code Insiders or set FULL_TYPE_VIEWER_VSCODE to its executable.");
  }
  let nativeExtension = env.FULL_TYPE_VIEWER_NATIVE_EXTENSION;
  if (nativeExtension === undefined) {
    const extensions = join(homedir(), ".vscode-insiders", "extensions");
    const entries = await readdir(extensions).catch(() => []);
    nativeExtension = entries.sort().find((entry) => entry.startsWith(`typescriptteam.native-preview-${NATIVE_VERSION}-`));
    if (nativeExtension !== undefined) nativeExtension = join(extensions, nativeExtension);
  }
  if (nativeExtension === undefined) {
    throw new Error(`Install TypeScriptTeam.native-preview ${NATIVE_VERSION} or set FULL_TYPE_VIEWER_NATIVE_EXTENSION to its directory.`);
  }
  const manifest = JSON.parse(await readFile(join(nativeExtension, "package.json"), "utf8")) as Record<string, unknown>;
  if (manifest.publisher !== "TypeScriptTeam" || manifest.name !== "native-preview" || manifest.version !== NATIVE_VERSION) {
    throw new Error(`FULL_TYPE_VIEWER_NATIVE_EXTENSION must point to TypeScriptTeam.native-preview ${NATIVE_VERSION}.`);
  }
  const acceptanceFile = env.FULL_TYPE_VIEWER_ACCEPTANCE_FILE;
  if (acceptanceFile !== undefined) await access(acceptanceFile, constants.R_OK);
  return { vscodeExecutable: resolve(vscodeExecutable), nativeExtension: resolve(nativeExtension), acceptanceFile };
}
