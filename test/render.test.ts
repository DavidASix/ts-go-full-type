import { describe, expect, it } from "vitest";
import type { CompleteTypeResult, TypeRenderNode, ViewState } from "../src/shared/protocol";
import { tokenizeTypeScript } from "../src/sidebar/codeLayout";
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
      root: { viewNodeId: "", text: `"<script>"`, state: "leaf", layout: "atom" },
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
        text: "root",
        state: "expanded",
        layout: "object",
        children: [{
          label: "record",
          node: {
            viewNodeId: "",
            state: "leaf",
            layout: "atom",
            text: [
              "Record<string, {",
              "  display_name: string;",
              "  is_dimension?: boolean | undefined;",
              "}> | {",
              "  display_name: string;",
              "}",
            ].join("\n"),
          },
        }],
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
    expect(stripMarkup(html)).toContain(expected);
  });

  it("renders separated native disclosure buttons with accurate state", () => {
    const expandable: CompleteTypeResult = {
      ...result,
      root: {
        viewNodeId: "",
        text: "root",
        state: "expanded",
        layout: "object",
        children: [{
          label: "child",
          node: { viewNodeId: "2:1", text: "Child", state: "collapsed", layout: "atom" },
        }],
      },
    };
    const html = renderHtml({ kind: "success", result: expandable, rawText: "" }, resources());
    expect(html).toContain('class="disclosure" type="button"');
    expect(html).toContain('aria-label="Expand Child" aria-expanded="false"');
    expect(html).toContain("width: 18px");
    expect(html).toContain("margin: 0 4px 0 2px");
    expect(renderCompleteType(expandable)).not.toMatch(/[▸▾↩]/);
  });

  it("enables wrapping only when requested", () => {
    const state: ViewState = { kind: "success", result, rawText: "" };
    const unwrapped = renderHtml(state, resources());
    const wrapped = renderHtml(state, { ...resources(), wordWrap: true });

    expect(unwrapped).toContain('<div class="type-code">');
    expect(unwrapped).not.toContain('<div class="type-code word-wrap">');
    expect(wrapped).toContain('<div class="type-code word-wrap">');
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

function stripMarkup(html: string): string {
  const body = html.match(/<div class="declaration">([\s\S]*?)<\/div>/)?.[1] ?? "";
  return body
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}
