import { build } from "esbuild";

await Promise.all([
  build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: true,
  }),
  build({
    entryPoints: ["src/sidebar/webview.ts"],
    bundle: true,
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
    minify: true,
  }),
  build({
    entryPoints: ["test/integration/runIntegration.ts"],
    bundle: true,
    outfile: ".test-build/runIntegration.js",
    platform: "node",
    format: "cjs",
    target: "node20",
  }),
  build({
    entryPoints: ["test/integration/suite.ts"],
    bundle: true,
    outfile: ".test-build/suite.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
  }),
]);
