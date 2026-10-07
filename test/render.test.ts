import { describe, expect, it } from "vitest";
import type { CompleteTypeResult, TypeRenderNode, ViewState } from "../src/shared/protocol";
import { tokenizeTypeScript } from "../src/sidebar/codeLayout";
import { escapeHtml, renderHtml } from "../src/sidebar/renderHtml";
import { renderCompleteType } from "../src/sidebar/renderText";

const leaf: TypeRenderNode = { viewNodeId: "", text: "string", content: { state: "leaf", layout: "atom" }};
const result: CompleteTypeResult = {
  name: "Example",
  compilerVersion: "7.0.2",
  sourceUri: "file:///workspace/types.ts",
  project: "/workspace/tsconfig.json",
  generation: 2,
  root: {
    viewNodeId: "",
    text: "{ dangerous: string }", content: { state: "expanded", layout: "object", children: [{ label: "dangerous", node: leaf }] },
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
      text: "Child", content: { state: "collapsed", layout: "atom" },
    };
    const raw = renderCompleteType({ ...result, root: { ...result.root, content: { state: "expanded", layout: "object", children: [{ label: "child", node: expandable }] } } });
    expect(raw).toContain("child: Child;");
    expect(raw).not.toMatch(/[▸▾↩]/);
    expect(raw).not.toContain("<button");
  });

  it("classifies compiler text without treating it as HTML", () => {
    const segments = tokenizeTypeScript(`{ display_name?: Record<string, "<script>">; kind: Cell.STRING; }`);
    expect(segments).toEqual(expect.arrayContaining([
      { kind: "token", text: "display_name", tokenClass: "property" },
      { kind: "token", text: "Record", tokenClass: "type" },
      { kind: "token", text: "string", tokenClass: "keyword" },
      { kind: "token", text: `"<script>"`, tokenClass: "string" },
      { kind: "token", text: "STRING", tokenClass: "enum-member" },
    ]));

    const unsafe: CompleteTypeResult = {
      ...result,
      root: { viewNodeId: "", text: `"<script>"`, content: { state: "leaf", layout: "atom" }},
    };
    const html = renderHtml({ kind: "success", result: unsafe, rawText: "" }, resources());
    expect(html).toContain('<span class="tok-string">&quot;&lt;script&gt;&quot;</span>');
    expect(html).not.toContain('>"<script>"<');
  });

  it("applies the containing indentation to every compiler continuation line", () => {
    const nested: CompleteTypeResult = {
      ...result,
      root: {
        viewNodeId: "",
        text: "root", content: { state: "expanded", layout: "object", children: [{
          label: "record",
          node: {
            viewNodeId: "", content: { state: "leaf", layout: "atom" },
            text: [
              "Record<string, {",
              "  display_name: string;",
              "  is_dimension?: boolean | undefined;",
              "}> | {",
              "  display_name: string;",
              "}",
            ].join("\n"),
          },
        }] },
      },
    };
    const expected = [
      "type Example =",
      "  {",
      "    record: Record<string, {",
      "      display_name: string;",
      "      is_dimension?: boolean | undefined;",
      "    }> | {",
      "      display_name: string;",
      "    };",
      "  };",
    ].join("\n");
    const raw = renderCompleteType(nested);
    expect(raw).toContain(expected);

    const html = renderHtml({ kind: "success", result: nested, rawText: raw }, resources());
    expect(html).toContain('role="tree"');
    expect(html).toContain('class="tree-label">record</span>');
    expect(html).toContain('aria-level="2"');
    expect(html).toContain('class="tree-group" role="group"');
  });

  it("renders indented tree rows with accurate expansion state and one tab stop", () => {
    const expandable: CompleteTypeResult = {
      ...result,
      root: {
        viewNodeId: "",
        text: "root", content: { state: "expanded", layout: "object", children: [{
          label: "child",
          node: { viewNodeId: "2:1", text: "Child", content: { state: "collapsed", layout: "atom" }},
        }] },
      },
    };
    const html = renderHtml({ kind: "success", result: expandable, rawText: "" }, resources());
    expect(html).toContain('role="treeitem" tabindex="-1" data-node-id="2:1"');
    expect(html).toContain('aria-label="child: Child" aria-expanded="false"');
    expect(html).toContain('class="disclosure" aria-hidden="true">▸</span>');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain("flex: 0 0 18px");
    expect(renderCompleteType(expandable)).not.toMatch(/[▸▾↩]/);
  });

  it("enables wrapping only when requested", () => {
    const state: ViewState = { kind: "success", result, rawText: "" };
    const unwrapped = renderHtml(state, resources());
    const wrapped = renderHtml(state, { ...resources(), wordWrap: true });

    expect(unwrapped).toContain('<ul class="type-tree"');
    expect(unwrapped).not.toContain('<ul class="type-tree word-wrap"');
    expect(wrapped).toContain('<ul class="type-tree word-wrap"');
    expect(wrapped).toContain("white-space: pre-wrap");
    expect(wrapped).toContain("overflow-wrap: anywhere");
  });
});

function resources() {
  return {
    cspSource: "vscode-webview:",
    scriptUri: { toString: () => "vscode-webview://webview/dist/webview.js" } as never,
    nonce: "fixedNonce",
  };
}
