import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";
import { resolveIntegrationEnvironment } from "./environment";

async function main(): Promise<void> {
  const repository = process.cwd();
  const environment = await resolveIntegrationEnvironment();
  const temporary = await mkdtemp(resolve(tmpdir(), "full-type-viewer-test-"));
  const extensions = resolve(temporary, "extensions");
  try {
    await mkdir(extensions);
    await symlink(environment.nativeExtension, resolve(extensions, basename(environment.nativeExtension)), "dir");
    await runTests({
      vscodeExecutablePath: environment.vscodeExecutable,
      extensionDevelopmentPath: repository,
      extensionTestsPath: resolve(repository, ".test-build/suite.js"),
      reuseMachineInstall: true,
      extensionTestsEnv: { FULL_TYPE_VIEWER_ACCEPTANCE_FILE: environment.acceptanceFile ?? "" },
      launchArgs: [
        resolve(repository, "fixtures"),
        `--user-data-dir=${resolve(temporary, "profile")}`,
        `--extensions-dir=${extensions}`,
        "--skip-welcome", "--skip-release-notes",
      ],
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
