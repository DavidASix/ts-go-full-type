import type * as vscode from "vscode";
import type { ViewState } from "../shared/protocol";
import { tokenizeTypeScript, type CodeSegment } from "./codeLayout";
import { buildTypeTree, type TypeTreeItem } from "./treeLayout";
import { normalizeThemeColor, type ThemeTokenPalette } from "./themePalette";

export interface HtmlResources {
  readonly cspSource: string;
  readonly scriptUri: vscode.Uri;
  readonly nonce: string;
  readonly palette?: ThemeTokenPalette;
  readonly wordWrap?: boolean;
}

export function renderHtml(state: ViewState, resources: HtmlResources): string {
  const body = renderViewContent(state, resources.wordWrap === true);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${escapeAttribute(resources.nonce)}'; script-src 'nonce-${escapeAttribute(resources.nonce)}';">
  <style nonce="${escapeAttribute(resources.nonce)}">
    :root { color-scheme: light dark; }
    html, body { height: 100%; }
    body { display: flex; flex-direction: column; margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
    .message { box-sizing: border-box; padding: 12px; color: var(--vscode-descriptionForeground, var(--vscode-foreground)); font: 12px/1.45 var(--vscode-font-family); }
    .error { color: var(--vscode-errorForeground, var(--vscode-foreground)); }
    .notice { padding-bottom: 4px; }
    #content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .scroll { box-sizing: border-box; flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 10px; }
    .type-tree {
      margin: 0;
      padding: 0;
      list-style: none;
      min-width: max-content;
      color: var(--ft-code);
      font: var(--vscode-editor-font-weight, 400) var(--vscode-editor-font-size, 13px)/1.6 var(--vscode-editor-font-family, monospace);
      user-select: text;
    }
    .tree-group { margin: 0 0 0 10px; padding: 0 0 0 13px; list-style: none; border-left: 1px solid var(--vscode-tree-indentGuidesStroke, var(--vscode-widget-border, transparent)); }
    .tree-row { display: flex; align-items: baseline; gap: 6px; min-height: 24px; box-sizing: border-box; padding: 1px 6px 1px 0; white-space: pre; border-radius: 2px; cursor: default; }
    .tree-row[data-expandable] { cursor: pointer; }
    .tree-row:hover { background: var(--vscode-list-hoverBackground, transparent); }
    .tree-item:focus { outline: none; }
    .tree-item:focus > .tree-row { color: var(--vscode-list-focusForeground, inherit); background: var(--vscode-list-focusBackground, transparent); outline: 1px solid var(--vscode-focusBorder, currentColor); outline-offset: -1px; }
    .tree-content { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .tree-label { flex: 0 0 auto; color: var(--ft-property); }
    .tree-root > .tree-row .tree-label { color: var(--ft-type); font-weight: 600; }
    .tree-description { color: var(--vscode-descriptionForeground, var(--ft-code)); }
    .tree-icon { flex: 0 0 18px; text-align: center; font: 11px/1.6 var(--vscode-editor-font-family, monospace); color: var(--vscode-symbolIcon-classForeground, var(--ft-type)); }
    .icon-primitive { color: var(--vscode-symbolIcon-stringForeground, var(--ft-string)); }
    .icon-details, .icon-function { color: var(--vscode-symbolIcon-methodForeground, var(--ft-type)); }
    .icon-union, .icon-intersection { color: var(--vscode-symbolIcon-enumForeground, var(--ft-type)); }
    .disclosure { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 18px; height: 20px; color: var(--vscode-icon-foreground, var(--ft-code)); font-size: 12px; }
    .recursive { margin-left: 4px; }
    .node-note { padding: 2px 8px 4px 48px; font-size: 11px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; }
    .type-tree.word-wrap { min-width: 0; width: 100%; }
    .word-wrap .tree-row { white-space: pre-wrap; }
    .word-wrap .tree-content { display: block; flex: 1 1 auto; overflow-wrap: anywhere; white-space: pre-wrap; }
    .metadata { margin: 0 0 8px; font: 11px/1.5 var(--vscode-font-family, sans-serif); color: var(--vscode-descriptionForeground); }
    .metadata summary { cursor: pointer; }
    .metadata div { padding: 4px 0; overflow-wrap: anywhere; }
    .tok-keyword { color: var(--ft-keyword, var(--ft-code)); }
    .tok-type { color: var(--ft-type, var(--ft-code)); }
    .tok-property { color: var(--ft-property, var(--ft-code)); }
    .tok-string { color: var(--ft-string, var(--ft-code)); }
    .tok-number { color: var(--ft-number, var(--ft-code)); }
    .tok-constant { color: var(--ft-constant, var(--ft-code)); }
    .tok-enum-member { color: var(--ft-enum-member, var(--ft-code)); }
    .tok-operator { color: var(--ft-operator, var(--ft-code)); }
    .tok-comment, .recursive { color: var(--ft-comment, var(--ft-code)); }
    body.vscode-high-contrast .tree-row:hover,
    body.vscode-high-contrast-light .tree-row:hover { outline: 1px solid var(--vscode-contrastActiveBorder, currentColor); outline-offset: -1px; }
  </style>
  <style id="theme-palette" nonce="${escapeAttribute(resources.nonce)}">.type-tree {
${renderPaletteProperties(resources.palette)}
  }</style>
</head>
<body><main id="content">${body}</main><script nonce="${escapeAttribute(resources.nonce)}" src="${escapeAttribute(resources.scriptUri.toString())}"></script></body>
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

export function renderViewContent(state: ViewState, wordWrap: boolean): string {
  switch (state.kind) {
    case "idle":
    case "loading":
      return `<div class="message" role="status">${escapeHtml(state.message)}</div>`;
    case "error":
      return `<div class="message error" role="alert">${escapeHtml(state.message)}</div>`;
    case "success": {
      const notice = state.notice === undefined
        ? ""
        : `<div class="message error notice" role="alert">${escapeHtml(state.notice)}</div>`;
      const treeClass = wordWrap ? "type-tree word-wrap" : "type-tree";
      const source = state.result.sourceUri.split("/").at(-1) ?? state.result.sourceUri;
      const metadata = `<details class="metadata" data-key="metadata"><summary>TypeScript ${escapeHtml(state.result.compilerVersion)} · ${escapeHtml(source)}</summary><div>${escapeHtml(state.result.sourceUri)}<br>Project: ${escapeHtml(state.result.project)}</div></details>`;
      return `${notice}<div class="scroll" data-key="scroll">${metadata}<ul class="${treeClass}" role="tree" aria-label="${escapeAttribute(`Type of ${state.result.name}`)}" data-generation="${state.result.generation}">${renderTreeItem(buildTypeTree(state.result), 1, 1, 1)}</ul></div>`;
    }
  }
}

function renderTreeItem(item: TypeTreeItem, level: number, position: number, size: number): string {
  const expandable = item.node.content.state === "collapsed" || item.node.content.state === "expanded";
  const expanded = item.node.content.state === "expanded";
  const state = expandable ? ` aria-expanded="${expanded}"` : "";
  const disclosure = expandable ? expanded ? "▾" : "▸" : "";
  const recursive = item.node.content.state === "recursive"
    ? `<span class="recursive" aria-label="Recursive reference" title="Recursive reference: this type already appears on this branch">↩</span>` : "";
  const children = item.children.length === 0 ? "" : `<ul class="tree-group" role="group">${item.children.map((child, index) => renderTreeItem(child, level + 1, index + 1, item.children.length)).join("")}</ul>`;
  const note = item.node.note === undefined ? "" : `<div class="node-note">${escapeHtml(item.node.note)}</div>`;
  const ariaLabel = `${item.label}: ${item.summary}${item.node.content.state === "recursive" ? ", recursive reference" : ""}`;
  return `<li role="none" data-key="${escapeAttribute(item.id)}"><div class="tree-item${level === 1 ? " tree-root" : ""}" role="treeitem" tabindex="${level === 1 ? "0" : "-1"}" data-node-id="${escapeAttribute(item.id)}" aria-level="${level}" aria-posinset="${position}" aria-setsize="${size}" aria-label="${escapeAttribute(ariaLabel)}"${state}><div class="tree-row"${expandable ? " data-expandable" : ""} title="${escapeAttribute(item.node.content.expressionText ?? item.node.text)}"><span class="disclosure" aria-hidden="true">${disclosure}</span><span class="tree-icon icon-${item.iconClass}" aria-hidden="true">${item.icon}</span><span class="tree-content"><span class="tree-label">${escapeHtml(item.label)}</span> <span class="tree-description">${tokenizeTypeScript(item.summary).map(renderSegment).join("")}</span>${recursive}</span></div>${note}${children}</div></li>`;
}

function renderSegment(segment: CodeSegment): string {
  switch (segment.kind) {
    case "text":
      return escapeHtml(segment.text);
    case "token":
      return `<span class="tok-${segment.tokenClass}">${escapeHtml(segment.text)}</span>`;
    case "recursive":
      return `<span class="recursive" role="img" aria-label="Recursive reference: ${escapeAttribute(segment.label)}" title="Recursive reference">↩ ${escapeHtml(segment.label)}</span>`;
    case "disclosure":
      return `<button class="disclosure" type="button" data-node-id="${escapeAttribute(segment.nodeId)}" aria-label="${escapeAttribute(segment.label)}" aria-expanded="${segment.state === "expanded"}">${segment.state === "expanded" ? "▾" : "▸"}</button>`;
  }
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\r|\n/g, " ");
}

export function renderPaletteProperties(palette: ThemeTokenPalette | undefined): string {
  const values: ReadonlyArray<readonly [string, keyof ThemeTokenPalette, string]> = [
    ["--ft-keyword", "keyword", "var(--vscode-symbolIcon-keywordForeground, var(--ft-code))"],
    ["--ft-type", "type", "var(--vscode-symbolIcon-classForeground, var(--ft-code))"],
    ["--ft-property", "property", "var(--vscode-symbolIcon-propertyForeground, var(--ft-code))"],
    ["--ft-string", "string", "var(--vscode-symbolIcon-stringForeground, var(--ft-code))"],
    ["--ft-number", "number", "var(--vscode-symbolIcon-numberForeground, var(--ft-code))"],
    ["--ft-constant", "constant", "var(--vscode-symbolIcon-constantForeground, var(--ft-code))"],
    ["--ft-enum-member", "enumMember", "var(--vscode-symbolIcon-enumeratorMemberForeground, var(--ft-code))"],
    ["--ft-operator", "operator", "var(--vscode-symbolIcon-operatorForeground, var(--ft-code))"],
    ["--ft-comment", "comment", "var(--vscode-descriptionForeground, var(--ft-code))"],
  ];
  return [
    "      --ft-code: var(--vscode-editor-foreground);",
    ...values.map(([variable, key, fallback]) =>
      `      ${variable}: ${normalizeThemeColor(palette?.[key]) ?? fallback};`),
  ].join("\n");
}
