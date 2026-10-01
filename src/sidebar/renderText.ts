import type { CompleteTypeResult, TypeRenderNode } from "../shared/protocol";
import { buildCompleteTypeLayout, renderNodeLines, serializeText } from "./codeLayout";

export function renderCompleteType(result: CompleteTypeResult): string {
  const layout = buildCompleteTypeLayout(result);
  return `${serializeText(layout.metadata)}\n\n${serializeText(layout.code)}`;
}

export function renderNode(node: TypeRenderNode, depth: number): string {
  return serializeText(renderNodeLines(node, depth));
}
