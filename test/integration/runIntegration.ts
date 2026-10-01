import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const repository = process.cwd();
  const profile = await mkdtemp(resolve(tmpdir(), "full-type-viewer-test-"));
  const extensions = await mkdtemp(resolve(tmpdir(), "full-type-viewer-extensions-"));
  const nativeExtension = "/home/davidasix/.vscode-insiders/extensions/typescriptteam.native-preview-1.0.1-linux-x64";
  await symlink(nativeExtension, resolve(extensions, basename(nativeExtension)), "dir");
  await runTests({
    vscodeExecutablePath: "/usr/share/code-insiders/code-insiders",
    extensionDevelopmentPath: repository,
    extensionTestsPath: resolve(repository, ".test-build/suite.js"),
    reuseMachineInstall: true,
    launchArgs: [
      resolve(repository, "fixtures"),
      `--user-data-dir=${profile}`,
      `--extensions-dir=${extensions}`,
    ],
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
