import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveIntegrationEnvironment } from "./integration/environment";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "full-type-environment-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

/**
 * Create a temporary native extension manifest for environment validation tests.
 * @param version Document version required for cache reuse.
 */
async function installation(version = "1.0.1") {
  const executable = join(root, "code-insiders");
  const extension = join(root, "native-preview");
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  await mkdir(extension);
  await writeFile(join(extension, "package.json"), JSON.stringify({ publisher: "TypeScriptTeam", name: "native-preview", version }));
  return { executable, extension };
}

describe("integration installation discovery", () => {
  it("runs with explicit tool paths from an arbitrary installation directory", async () => {
    const { executable, extension } = await installation();
    const environment = await resolveIntegrationEnvironment({ FULL_TYPE_VIEWER_VSCODE: executable, FULL_TYPE_VIEWER_NATIVE_EXTENSION: extension });
    expect(environment).toEqual({ vscodeExecutable: executable, nativeExtension: extension, acceptanceFile: undefined });
  });

  it("discovers the Insiders binary behind the PATH launcher", async () => {
    const { executable, extension } = await installation();
    const bin = join(root, "bin");
    await mkdir(bin);
    await symlink(executable, join(bin, "code-insiders"));
    const environment = await resolveIntegrationEnvironment({ PATH: bin, FULL_TYPE_VIEWER_NATIVE_EXTENSION: extension });
    expect(environment.vscodeExecutable).toBe(executable);
  });

  it("rejects incompatible native protocol installations before launching VS Code", async () => {
    const { executable, extension } = await installation("9.0.0");
    await expect(resolveIntegrationEnvironment({ FULL_TYPE_VIEWER_VSCODE: executable, FULL_TYPE_VIEWER_NATIVE_EXTENSION: extension })).rejects.toThrow(Error);
  });
});
