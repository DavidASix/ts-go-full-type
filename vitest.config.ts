import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: { statements: 80, branches: 65, functions: 80, lines: 80 },
      reporter: ["text", "html"],
      include: ["src/controller/**/*.ts", "src/native/nativeConnection.ts", "src/native/completeTypeProvider.ts", "src/sidebar/webview.ts", "src/sidebar/themePaletteResolver.ts"],
    },
  },
});
