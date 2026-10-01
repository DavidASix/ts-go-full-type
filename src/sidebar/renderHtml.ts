import type * as vscode from "vscode";
import type { TypeRenderEdge, TypeRenderNode, ViewState } from "../shared/protocol";

export interface HtmlResources {
  readonly cspSource: string;
  readonly scriptUri: vscode.Uri;
  readonly nonce: string;
}

export function renderHtml(state: ViewState, resources: HtmlResources): string {
  const body = renderState(state);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${escapeAttribute(resources.nonce)}'; script-src 'nonce-${escapeAttribute(resources.nonce)}';">
  <style nonce="${escapeAttribute(resources.nonce)}">
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 8px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
    .message { font-family: var(--vscode-font-family); line-height: 1.45; padding: 4px; }
    .error { color: var(--vscode-errorForeground); }
    .metadata { color: var(--vscode-descriptionForeground); font: 11px/1.45 var(--vscode-editor-font-family); margin-bottom: 8px; white-space: pre; }
    .type { box-sizing: border-box; min-width: max-content; font: var(--vscode-editor-font-weight) var(--vscode-editor-font-size)/var(--vscode-editor-line-height) var(--vscode-editor-font-family); white-space: pre; tab-size: 2; user-select: text; }
    .scroll { overflow: auto; max-height: calc(100vh - 16px); }
    .disclosure { appearance: none; border: 0; color: var(--vscode-foreground); background: transparent; font: inherit; line-height: inherit; padding: 0 2px 0 0; cursor: pointer; }
    .disclosure:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .recursive { color: var(--vscode-descriptionForeground); }
    .comment { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>${body}<script nonce="${escapeAttribute(resources.nonce)}" src="${escapeAttribute(resources.scriptUri.toString())}"></script></body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderState(state: ViewState): string {
  switch (state.kind) {
    case "idle":
    case "loading":
      return `<div class="message" role="status">${escapeHtml(state.message)}</div>`;
    case "error":
      return `<div class="message error" role="alert">${escapeHtml(state.message)}</div>`;
    case "success": {
      const result = state.result;
      const metadata = `// TypeScript ${result.compilerVersion}\n// ${result.sourceUri}\n// Project: ${result.project}`;
      const notice = state.notice === undefined ? "" : `<div class="message error" role="alert">${escapeHtml(state.notice)}</div>`;
      return `${notice}<div class="scroll"><div class="metadata">${escapeHtml(metadata)}</div><div class="type">type ${escapeHtml(result.name)} =\n  ${renderNodeHtml(result.root, 1)};</div></div>`;
    }
  }
}

function renderNodeHtml(node: TypeRenderNode, depth: number): string {
  if (node.state === "recursive") {
    return `<span class="recursive" aria-label="Recursive reference">↩ ${escapeHtml(node.text)}</span>`;
  }
  if (node.state === "leaf") {
    return node.note === undefined
      ? escapeHtml(node.text)
      : `${escapeHtml(node.text)}\n<span class="comment">/* Note: ${escapeHtml(node.note)} */</span>`;
  }
  const control = `<button class="disclosure" data-node-id="${escapeAttribute(node.viewNodeId)}" aria-label="${node.state === "expanded" ? "Collapse" : "Expand"} ${escapeAttribute(node.text)}" aria-expanded="${node.state === "expanded"}">${node.state === "expanded" ? "▾" : "▸"}</button>`;
  if (node.state === "collapsed") {
    return `${control}${escapeHtml(node.text)}`;
  }
  const structure = renderLayoutHtml(node, depth);
  if (node.viewNodeId.length === 0) {
    return structure;
  }
  return `${control}<span class="comment">/* ${escapeHtml(node.text)} */</span> (${structure})`;
}

function renderLayoutHtml(node: TypeRenderNode, depth: number): string {
  const children = node.children ?? [];
  let result: string;
  switch (node.layout) {
    case "object":
      result = renderObjectHtml(children, depth, node.provenance);
      break;
    case "union":
      result = children.map((edge) => `| ${renderNodeHtml(edge.node, depth + 1)}`).join(`\n${" ".repeat(depth * 2)}`);
      break;
    case "intersection":
      result = children.map((edge) => `&amp; ${renderNodeHtml(edge.node, depth + 1)}`).join(`\n${" ".repeat(depth * 2)}`);
      break;
    case "array":
      result = children.length === 0 ? escapeHtml(node.text) : `Array&lt;${renderNodeHtml(children[0]!.node, depth + 1)}&gt;`;
      break;
    case "tuple":
      result = `[${children.map((edge) => renderNodeHtml(edge.node, depth + 1)).join(", ")}]`;
      break;
    case "atom":
      result = escapeHtml(node.text);
      break;
  }
  return node.note === undefined
    ? result
    : `${result}\n<span class="comment">/* Note: ${escapeHtml(node.note)} */</span>`;
}

function renderObjectHtml(children: readonly TypeRenderEdge[], depth: number, provenance?: string): string {
  const indentation = " ".repeat((depth + 1) * 2);
  const lines = ["{"];
  if (provenance !== undefined) {
    lines.push(`${indentation}<span class="comment">// ${escapeHtml(provenance)}</span>`);
  }
  for (const edge of children) {
    const label = escapeHtml(edge.label ?? "value");
    const annotation = edge.annotation === undefined
      ? ""
      : ` <span class="comment">// ${escapeHtml(edge.annotation)}</span>`;
    lines.push(`${indentation}${label}${edge.optional === true ? "?" : ""}: ${renderNodeHtml(edge.node, depth + 1)};${annotation}`);
  }
  lines.push(`${" ".repeat(depth * 2)}}`);
  return lines.join("\n");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\r|\n/g, " ");
}
