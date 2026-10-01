import type { CompleteTypeResult, TypeRenderEdge, TypeRenderNode } from "../shared/protocol";

export function renderCompleteType(result: CompleteTypeResult): string {
  const expression = renderNode(result.root, 0);
  return [
    `// TypeScript ${result.compilerVersion}`,
    `// ${displaySource(result.sourceUri)}`,
    `// Project: ${result.project}`,
    "",
    `type ${result.name} =`,
    indent(expression, 2) + ";",
  ].join("\n");
}

export function renderNode(node: TypeRenderNode, depth: number): string {
  if (node.state !== "expanded") {
    return node.note === undefined
      ? node.text
      : `${node.text}\n/* Note: ${oneLine(node.note)} */`;
  }
  const structure = renderLayout(node, depth);
  if (node.viewNodeId.length === 0) {
    return structure;
  }
  const provenance = oneLine(node.text);
  return `/* expanded: ${provenance} */ (${structure})`;
}

function renderLayout(node: TypeRenderNode, depth: number): string {
  const children = node.children ?? [];
  let result: string;
  switch (node.layout) {
    case "object":
      result = renderObject(children, depth, node.provenance);
      break;
    case "union":
      result = renderJoined(children, "|", depth);
      break;
    case "intersection":
      result = renderJoined(children, "&", depth);
      break;
    case "array":
      result = children.length === 0 ? node.text : `Array<${renderNode(children[0]!.node, depth + 1)}>`;
      break;
    case "tuple":
      result = `[${children.map((edge) => renderNode(edge.node, depth + 1)).join(", ")}]`;
      break;
    case "atom":
      result = node.text;
      break;
  }
  if (node.note !== undefined) {
    result += `\n/* Note: ${oneLine(node.note)} */`;
  }
  return result;
}

function renderObject(
  children: readonly TypeRenderEdge[],
  depth: number,
  provenance?: string,
): string {
  const lines = ["{"];
  if (provenance !== undefined) {
    lines.push(`${" ".repeat((depth + 1) * 2)}// ${oneLine(provenance)}`);
  }
  for (const edge of children) {
    const label = edge.label ?? "value";
    const optional = edge.optional === true ? "?" : "";
    const value = renderNode(edge.node, depth + 1);
    const annotation = edge.annotation === undefined ? "" : ` // ${oneLine(edge.annotation)}`;
    lines.push(`${" ".repeat((depth + 1) * 2)}${label}${optional}: ${indentContinuation(value, (depth + 1) * 2 + label.length + optional.length + 2)};${annotation}`);
  }
  lines.push(`${" ".repeat(depth * 2)}}`);
  return lines.join("\n");
}

function renderJoined(children: readonly TypeRenderEdge[], operator: "|" | "&", depth: number): string {
  if (children.length === 0) {
    return "never";
  }
  return children
    .map((edge) => `${operator} ${indentContinuation(renderNode(edge.node, depth + 1), 2)}`)
    .join(`\n${" ".repeat(depth * 2)}`);
}

function indent(value: string, count: number): string {
  const prefix = " ".repeat(count);
  return value.split("\n").map((line) => prefix + line).join("\n");
}

function indentContinuation(value: string, count: number): string {
  const lines = value.split("\n");
  return lines.map((line, index) => index === 0 ? line : " ".repeat(count) + line).join("\n");
}

function oneLine(value: string): string {
  return value.replace(/\*\//g, "* /").replace(/\s+/g, " ").trim();
}

function displaySource(sourceUri: string): string {
  try {
    const url = new URL(sourceUri);
    return decodeURIComponent(url.pathname).replace(/^\//, "");
  } catch {
    return sourceUri;
  }
}
