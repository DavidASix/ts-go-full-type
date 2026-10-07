import { describe, expect, it } from "vitest";
import { buildTypeTree } from "../src/sidebar/treeLayout";
import type { CompleteTypeResult, TypeRenderNode } from "../src/shared/protocol";
import { renderHtml } from "../src/sidebar/renderHtml";

function result(root: TypeRenderNode): CompleteTypeResult {
  return { name: "Example", compilerVersion: "7.0.2", sourceUri: "file:///types.ts", project: "/tsconfig.json", generation: 1, root };
}
const leaf: TypeRenderNode = { viewNodeId: "1:leaf", text: '"two  spaces"', content: { state: "leaf", layout: "atom" }};

describe("type tree", () => {
  it("keeps literal whitespace and gives optional properties their own rows", () => {
    const tree = buildTypeTree(result({ viewNodeId: "1:root", text: "Example", typeKind: "object", content: { state: "expanded", layout: "object", children: [{ label: "value", optional: true, node: leaf }] }}));
    expect(tree.label).toBe("Example");
    expect(tree.summary).toBe("object");
    expect(tree.children[0]).toMatchObject({ label: "value?", summary: '"two  spaces"', icon: "abc" });
  });

  it.each([
    ["array", "element"], ["tuple", "[0]"], ["union", "member 1"], ["intersection", "part 1"],
  ] as const)("labels %s child relationships", (layout, label) => {
    const tree = buildTypeTree(result({ viewNodeId: "root", text: "Example", typeKind: layout, content: { state: "expanded", layout, children: [{ node: leaf }] } }));
    expect(tree.children[0]?.label).toBe(label);
  });

  it("keeps anonymous function and tuple rows compact", () => {
    const function_ = buildTypeTree(result({ viewNodeId: "f", text: "(input: { id: string }) => { value: number }", typeKind: "function", content: { state: "collapsed", layout: "atom" }}));
    expect(function_).toMatchObject({ summary: "function", icon: "ƒ" });
    const tuple = buildTypeTree(result({ viewNodeId: "t", text: "readonly [name: string, count?: number]", typeKind: "tuple", content: { state: "collapsed", layout: "atom" }}));
    expect(tuple.summary).toBe("readonly tuple");
  });

  it("labels constrained type details separately from callable nodes", () => {
    const tree = buildTypeTree({ ...result({ viewNodeId: "p", text: "T", typeKind: "details", content: { state: "expanded", layout: "details", children: [] }}), name: "T" });
    expect(tree).toMatchObject({ summary: "type", icon: "◇" });
  });

  it("renders only visible branches and never offers primitive or recursive nodes as expandable", () => {
    const recursive: TypeRenderNode = { viewNodeId: "1:cycle", text: "Example", content: { state: "recursive", layout: "atom" }};
    const collapsed: TypeRenderNode = { viewNodeId: "1:child", text: "Nested", content: { state: "collapsed", layout: "atom" }};
    const state = result({ viewNodeId: "1:root", text: "Example", content: { state: "expanded", layout: "object", children: [{ label: "value", node: leaf }, { label: "self", node: recursive }, { label: "nested", node: collapsed }] }});
    const html = renderHtml({ kind: "success", result: state, rawText: "" }, { nonce: "test", scriptUri: { toString: () => "/webview.js" } as never });
    expect(html.match(/role="treeitem"/g)).toHaveLength(4);
    expect(html.match(/aria-expanded=/g)).toHaveLength(2);
    expect(html).not.toContain('class="tree-label">hidden');
    expect(html).toContain('aria-label="self: Example, recursive reference"');
    expect(html).toContain('aria-label="Recursive reference"');
  });

  it("escapes property names, type text, node IDs, metadata, and notices", () => {
    const unsafe = result({ viewNodeId: '"><script>', text: '"<script>"', content: { state: "leaf", layout: "atom" }});
    const html = renderHtml({ kind: "success", result: { ...unsafe, name: "<img onerror=alert(1)>" }, rawText: "", notice: "<script>alert(1)</script>" }, { nonce: "test", scriptUri: { toString: () => "/webview.js" } as never });
    expect(html).not.toContain("<img onerror");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('data-node-id="&quot;&gt;&lt;script&gt;"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
