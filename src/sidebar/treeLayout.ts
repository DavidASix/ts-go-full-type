import type { CompleteTypeResult, NodeLayout, TypeRenderEdge, TypeRenderNode } from "../shared/protocol";
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

/**
 * Build one visible tree row and preserve child identities and relationship labels.
 * @param node Syntax or presentation node being processed.
 * @param label Property or relationship label to display or locate.
 * @param path Stable fallback identity for nodes without graph IDs.
 */
function item(node: TypeRenderNode, label: string, path: string): TypeTreeItem {
  const kind = node.typeKind ?? node.content.layout;
  const icons: Partial<Record<NodeLayout | "function", string>> = {
    object: "{}", array: "[]", tuple: "[·]", union: "∪", intersection: "∩", function: "ƒ",
  };
  let icon = icons[kind] ?? "◇";
  if (icons[kind] === undefined) {
    if (/^(number|bigint|\d)/.test(node.text)) icon = "#";
    else if (/^(string|["'`])/.test(node.text)) icon = "abc";
  }
  const iconClass = kind === "atom" ? "primitive" : kind;
  const summary = node.text === label ? kindLabel(kind) : summarize(node.text, kind);
  const children = node.content.state !== "expanded" ? [] : (node.content.children ?? []).map((edge, index) =>
    item(edge.node, edgeLabel(edge, node, index), `${path}:${index}`));
  return { id: node.viewNodeId || path, label, summary, icon, iconClass, node, children };
}

/**
 * Present property modifiers or the semantic relationship of an unlabeled child.
 * @param edge Child relationship and its presentation metadata.
 * @param parent Containing node that determines the child relationship label.
 * @param index Zero-based position of the child relationship.
 */
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

/**
 * Keep structural rows compact without losing literal whitespace or escape sequences.
 * @param text Compiler presentation or label charged to the graph budget.
 * @param kind Compiler token kind or presentation category.
 */
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
