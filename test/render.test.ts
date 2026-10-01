import { describe, expect, it } from "vitest";
import type { CompleteTypeResult, TypeRenderNode, ViewState } from "../src/shared/protocol";
import { escapeHtml, renderHtml } from "../src/sidebar/renderHtml";
import { renderCompleteType } from "../src/sidebar/renderText";

const leaf: TypeRenderNode = { viewNodeId: "", text: "string", state: "leaf", layout: "atom" };
const result: CompleteTypeResult = {
  name: "Example",
  compilerVersion: "7.0.2",
  sourceUri: "file:///workspace/types.ts",
  project: "/workspace/tsconfig.json",
  generation: 2,
  root: {
    viewNodeId: "",
    text: "{ dangerous: string }",
    state: "expanded",
    layout: "object",
    children: [{ label: "dangerous", node: leaf }],
  },
};

describe("rendering", () => {
  it("escapes every HTML-sensitive character", () => {
    expect(escapeHtml(`<script x='1'>&\"`)).toBe("&lt;script x=&#39;1&#39;&gt;&amp;&quot;");
  });

  it.each<ViewState>([
    { kind: "idle", message: "Place the cursor" },
    { kind: "loading", message: "Resolving Example..." },
    { kind: "error", message: "Try again" },
    { kind: "success", result, rawText: "raw" },
  ])("renders the $kind view state with a nonce CSP", (state) => {
    const html = renderHtml(state, {
      cspSource: "vscode-webview:",
      scriptUri: { toString: () => "vscode-webview://webview/dist/webview.js" } as never,
      nonce: "fixedNonce",
    });
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-fixedNonce'");
    expect(html).toContain('nonce="fixedNonce"');
    expect(html).not.toContain("<script>\n");
  });

  it("copies raw expanded TypeScript without disclosure glyphs or HTML", () => {
    const expandable: TypeRenderNode = {
      viewNodeId: "2:1",
      text: "Child",
      state: "collapsed",
      layout: "atom",
    };
    result.root.children = [{ label: "child", node: expandable }];
    const raw = renderCompleteType(result);
    expect(raw).toContain("child: Child;");
    expect(raw).not.toMatch(/[▸▾↩]/);
    expect(raw).not.toContain("<button");
  });
});
