import type * as vscode from "vscode";
import type { ViewState } from "../shared/protocol";
import { buildCompleteTypeLayout, type CodeLine, type CodeSegment } from "./codeLayout";
import { normalizeThemeColor, type ThemeTokenPalette } from "./themePalette";

export interface HtmlResources {
  readonly cspSource: string;
  readonly scriptUri: vscode.Uri;
  readonly nonce: string;
  readonly palette?: ThemeTokenPalette;
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
    html, body { height: 100%; }
    body { display: flex; flex-direction: column; margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
    .message { box-sizing: border-box; padding: 12px; color: var(--vscode-descriptionForeground, var(--vscode-foreground)); font: 12px/1.45 var(--vscode-font-family); }
    .error { color: var(--vscode-errorForeground, var(--vscode-foreground)); }
    .notice { padding-bottom: 4px; }
    .scroll { box-sizing: border-box; flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 10px; }
    .type-code {
${renderPaletteProperties(resources.palette)}
      box-sizing: border-box;
      min-width: max-content;
      color: var(--ft-code);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      font-weight: var(--vscode-editor-font-weight);
      line-height: var(--vscode-editor-line-height);
      white-space: pre;
      tab-size: 2;
      user-select: text;
    }
    .metadata { margin-bottom: 8px; color: var(--ft-comment); }
    .tok-keyword { color: var(--ft-keyword, var(--ft-code)); }
    .tok-type { color: var(--ft-type, var(--ft-code)); }
    .tok-property { color: var(--ft-property, var(--ft-code)); }
    .tok-string { color: var(--ft-string, var(--ft-code)); }
    .tok-number { color: var(--ft-number, var(--ft-code)); }
    .tok-constant { color: var(--ft-constant, var(--ft-code)); }
    .tok-enum-member { color: var(--ft-enum-member, var(--ft-code)); }
    .tok-operator { color: var(--ft-operator, var(--ft-code)); }
    .tok-comment, .recursive { color: var(--ft-comment, var(--ft-code)); }
    .disclosure {
      appearance: none;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      min-width: 18px;
      height: 18px;
      min-height: 18px;
      margin: 0 4px 0 2px;
      padding: 0;
      border: 0;
      border-radius: 3px;
      color: var(--vscode-icon-foreground, var(--ft-code));
      background: transparent;
      font: inherit;
      font-size: 12px;
      line-height: 1;
      vertical-align: middle;
      cursor: pointer;
    }
    .disclosure:hover { background: var(--vscode-toolbar-hoverBackground, transparent); }
    .disclosure:active { background: var(--vscode-toolbar-activeBackground, var(--vscode-toolbar-hoverBackground, transparent)); }
    .disclosure:focus-visible { outline: 1px solid var(--vscode-focusBorder, currentColor); outline-offset: 1px; }
    body.vscode-high-contrast .disclosure:hover,
    body.vscode-high-contrast-light .disclosure:hover {
      box-shadow: inset 0 0 0 1px var(--vscode-contrastActiveBorder, var(--vscode-focusBorder, currentColor));
    }
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
      const layout = buildCompleteTypeLayout(state.result);
      const notice = state.notice === undefined
        ? ""
        : `<div class="message error notice" role="alert">${escapeHtml(state.notice)}</div>`;
      return `${notice}<div class="scroll"><div class="type-code"><div class="metadata">${renderLines(layout.metadata)}</div><div class="declaration">${renderLines(layout.code)}</div></div></div>`;
    }
  }
}

function renderLines(lines: readonly CodeLine[]): string {
  return lines.map((line) => " ".repeat(line.indentColumns) + line.segments.map(renderSegment).join("")).join("\n");
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

function renderPaletteProperties(palette: ThemeTokenPalette | undefined): string {
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
