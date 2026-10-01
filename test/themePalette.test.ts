import { describe, expect, it } from "vitest";
import {
  mergeThemeData,
  normalizeThemeColor,
  parseThemeData,
  resolveThemeTokenPalette,
} from "../src/sidebar/themePalette";
import { renderHtml } from "../src/sidebar/renderHtml";
import type { CompleteTypeResult } from "../src/shared/protocol";

describe("theme token palette", () => {
  it("parses JSONC theme files and merges inherited rules before local rules", () => {
    const inherited = parseThemeData(`{
      // inherited semantic colors
      "semanticTokenColors": {
        "keyword": "#ABC",
        "property": { "foreground": "#112233" },
      },
      "tokenColors": [
        { "scope": "string.quoted", "settings": { "foreground": "#445566" } },
        { "scope": ["entity.name.type", "support.type"], "settings": { "foreground": "#778899" } },
      ],
    }`);
    const local = parseThemeData(`{
      "include": "./base.json",
      /* local rules win */
      "semanticTokenColors": { "type": { "foreground": "#AABBCCDD" } },
      "tokenColors": [
        { "scope": "variable.other.property.ts", "settings": { "foreground": "#010203" } },
        { "scope": "keyword.operator", "settings": { "foreground": "#def" } },
      ],
    }`);

    expect(inherited).toBeDefined();
    expect(local?.include).toBe("./base.json");
    const palette = resolveThemeTokenPalette(mergeThemeData(inherited!, local!));
    expect(palette).toEqual({
      keyword: "#abc",
      type: "#aabbccdd",
      property: "#112233",
      string: "#445566",
      operator: "#def",
    });
  });

  it("accepts only normalized VS Code hex foregrounds", () => {
    expect(normalizeThemeColor(" #A1b2C3 ")).toBe("#a1b2c3");
    expect(normalizeThemeColor("#abcd")).toBe("#abcd");
    expect(normalizeThemeColor("red")).toBeUndefined();
    expect(normalizeThemeColor("#12345")).toBeUndefined();
    expect(normalizeThemeColor("#fff; } body { display:none")).toBeUndefined();
  });

  it("emits resolved colors while rejecting untrusted stylesheet values", () => {
    const result: CompleteTypeResult = {
      name: "Example",
      compilerVersion: "7.0.2",
      sourceUri: "file:///workspace/types.ts",
      project: "/workspace/tsconfig.json",
      generation: 1,
      root: { viewNodeId: "", text: "string", state: "leaf", layout: "atom" },
    };
    const html = renderHtml(
      { kind: "success", result, rawText: "" },
      {
        cspSource: "vscode-webview:",
        scriptUri: { toString: () => "vscode-webview://webview/dist/webview.js" } as never,
        nonce: "fixedNonce",
        palette: {
          keyword: "#AABBCC",
          type: "#fff; } body { display: none",
        },
      },
    );
    expect(html).toContain("--ft-keyword: #aabbcc;");
    expect(html).toContain("--ft-type: var(--vscode-symbolIcon-classForeground, var(--ft-code));");
    expect(html).not.toContain("body { display: none");
  });
});
