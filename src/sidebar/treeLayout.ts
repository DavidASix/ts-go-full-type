import type { CompleteTypeResult, TypeRenderEdge, TypeRenderNode } from "../shared/protocol";
import { tokenizeTypeScript } from "./codeLayout";

export interface TypeTreeItem {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly icon: string;
  readonly iconClass: string;
  readonly node: TypeRenderNode;
  readonly children: readonly TypeTreeItem[];
}

export function buildTypeTree(result: CompleteTypeResult): TypeTreeItem {
  return item(result.root, result.name, `root:${result.generation}`);
}

function item(node: TypeRenderNode, label: string, path: string): TypeTreeItem {
  const kind = node.typeKind ?? node.content.layout;
  const icon = kind === "object" ? "{}" : kind === "array" ? "[]" : kind === "tuple" ? "[·]"
    : kind === "union" ? "∪" : kind === "intersection" ? "∩" : kind === "function" ? "ƒ"
    : /^(number|bigint|\d)/.test(node.text) ? "#"
    : /^(string|["'`])/.test(node.text) ? "abc" : "◇";
  const iconClass = kind === "atom" ? "primitive" : kind;
  const summary = node.text === label ? kindLabel(kind) : summarize(node.text, kind);
  const children = node.content.state !== "expanded" ? [] : (node.content.children ?? []).map((edge, index) =>
    item(edge.node, edgeLabel(edge, node, index), `${path}:${index}`));
  return { id: node.viewNodeId || path, label, summary, icon, iconClass, node, children };
}

function edgeLabel(edge: TypeRenderEdge, parent: TypeRenderNode, index: number): string {
  if (edge.label !== undefined) return `${edge.readonly ? "readonly " : ""}${edge.label}${edge.optional ? "?" : ""}`;
  switch (parent.content.layout) {
    case "array": return "element";
    case "tuple": return `[${index}]`;
    case "union": return `member ${index + 1}`;
    case "intersection": return `part ${index + 1}`;
    default: return `type ${index + 1}`;
  }
}

function summarize(text: string, kind: string): string {
  // Summarize structural expressions; opening the row reveals their contents.
  // String literals keep their original spaces and escape sequences.
  if (kind === "function") return "function";
  if (kind === "tuple" && /^(readonly )?\[/.test(text)) return text.startsWith("readonly ") ? "readonly tuple" : "tuple";
  if (text.trimStart().startsWith("{")) return kindLabel(kind);
  return tokenizeTypeScript(text).map((segment) =>
    segment.kind === "text" && /^\s+$/.test(segment.text) ? " "
      : segment.kind === "text" || segment.kind === "token" ? segment.text : "").join("");
}

function kindLabel(kind: string): string {
  return kind === "details" ? "type" : kind === "atom" ? "type" : kind;
}
