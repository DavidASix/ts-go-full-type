import { createScanner, SyntaxKind } from "typescript/unstable/ast";
import type { CompleteTypeResult, TypeRenderEdge, TypeRenderNode } from "../shared/protocol";

export type TokenClass =
  | "keyword"
  | "type"
  | "property"
  | "string"
  | "number"
  | "constant"
  | "enum-member"
  | "operator"
  | "comment";

export type CodeSegment =
  | { readonly kind: "token"; readonly text: string; readonly tokenClass: TokenClass }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "disclosure"; readonly nodeId: string; readonly label: string; readonly state: "collapsed" | "expanded" }
  | { readonly kind: "recursive"; readonly label: string };

export interface CodeLine {
  readonly indentColumns: number;
  readonly segments: readonly CodeSegment[];
}

export interface CompleteTypeLayout {
  readonly metadata: readonly CodeLine[];
  readonly code: readonly CodeLine[];
}

const OPERATOR_TOKENS = new Set<SyntaxKind>([
  SyntaxKind.LessThanToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.EqualsGreaterThanToken,
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.AsteriskAsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken,
  SyntaxKind.AmpersandToken,
  SyntaxKind.BarToken,
  SyntaxKind.CaretToken,
  SyntaxKind.ExclamationToken,
  SyntaxKind.TildeToken,
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionToken,
  SyntaxKind.ColonToken,
  SyntaxKind.QuestionQuestionToken,
  SyntaxKind.EqualsToken,
]);

export function buildCompleteTypeLayout(result: CompleteTypeResult): CompleteTypeLayout {
  const metadata = [
    commentLine(`// TypeScript ${result.compilerVersion}`),
    commentLine(`// ${displaySource(result.sourceUri)}`),
    commentLine(`// Project: ${result.project}`),
  ];
  const expression = renderNode(result.root, 1);
  const declaration = line(0,
    token("type", "keyword"),
    text(" "),
    token(result.name, "type"),
    text(" "),
    token("=", "operator"),
  );
  appendSegment(expression.at(-1), text(";"));
  return { metadata, code: [declaration, ...expression] };
}

export function tokenizeTypeScript(value: string): readonly CodeSegment[] {
  const scanner = createScanner(false, undefined, value);
  const scanned: Array<{ kind: SyntaxKind; text: string }> = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    scanned.push({ kind, text: scanner.getTokenText() });
  }
  const significant = scanned
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !isTrivia(entry.kind));
  const significantPosition = new Map(significant.map(({ index }, position) => [index, position]));

  return scanned.map((entry, index): CodeSegment => {
    if (entry.kind === SyntaxKind.WhitespaceTrivia || entry.kind === SyntaxKind.NewLineTrivia) {
      return text(entry.text);
    }
    if (entry.kind === SyntaxKind.SingleLineCommentTrivia || entry.kind === SyntaxKind.MultiLineCommentTrivia) {
      return token(entry.text, "comment");
    }
    const position = significantPosition.get(index);
    const previous = position === undefined || position === 0 ? undefined : significant[position - 1]?.entry;
    const next = position === undefined ? undefined : significant[position + 1]?.entry;
    const nextAfterQuestion = position === undefined ? undefined : significant[position + 2]?.entry;
    const property = isPropertyToken(entry.kind) &&
      (next?.kind === SyntaxKind.ColonToken ||
        (next?.kind === SyntaxKind.QuestionToken && nextAfterQuestion?.kind === SyntaxKind.ColonToken)) &&
      isPropertyPosition(significant, position);

    if (property) {
      return token(entry.text, "property");
    }
    if (isStringToken(entry.kind)) {
      return token(entry.text, "string");
    }
    if (entry.kind === SyntaxKind.NumericLiteral || entry.kind === SyntaxKind.BigIntLiteral) {
      return token(entry.text, "number");
    }
    if (entry.kind >= SyntaxKind.FirstKeyword && entry.kind <= SyntaxKind.LastKeyword) {
      return token(entry.text, "keyword");
    }
    if (entry.kind === SyntaxKind.Identifier) {
      if (previous?.kind === SyntaxKind.DotToken) {
        return token(entry.text, "enum-member");
      }
      if (entry.text === "NaN" || entry.text === "Infinity") {
        return token(entry.text, "constant");
      }
      return token(entry.text, "type");
    }
    if (OPERATOR_TOKENS.has(entry.kind)) {
      return token(entry.text, "operator");
    }
    return text(entry.text);
  });
}

export function serializeText(lines: readonly CodeLine[]): string {
  return lines
    .map((entry) => " ".repeat(entry.indentColumns) + entry.segments.map(segmentText).join(""))
    .join("\n");
}

export function renderNodeLines(node: TypeRenderNode, depth: number): CodeLine[] {
  return renderNode(node, depth);
}

function renderNode(node: TypeRenderNode, depth: number): MutableCodeLine[] {
  const baseIndent = depth * 2;
  if (node.content.state === "recursive") {
    return [line(baseIndent, { kind: "recursive", label: node.text })];
  }
  if (node.content.state === "leaf" || node.content.state === "collapsed") {
    const lines = compilerLines(node.text, baseIndent);
    if (node.content.state === "collapsed" && node.viewNodeId.length > 0) {
      lines[0]?.segments.unshift(disclosure(node, "collapsed"));
    }
    appendNote(lines, node.note, baseIndent);
    return lines;
  }

  const lines = renderLayout(node, depth);
  if (node.viewNodeId.length > 0) {
    lines[0]?.segments.unshift(
      disclosure(node, "expanded"),
      token(`/* expanded: ${oneLine(node.text)} */`, "comment"),
      text(" ("),
    );
    appendSegment(lines.at(-1), text(")"));
  }
  appendNote(lines, node.note, baseIndent);
  return lines;
}

function renderLayout(node: TypeRenderNode, depth: number): MutableCodeLine[] {
  const children = node.content.children ?? [];
  switch (node.content.layout) {
    case "object":
      return renderObject(children, depth, node.provenance);
    case "union":
      return renderJoined(children, "|", depth);
    case "intersection":
      return renderJoined(children, "&", depth);
    case "array":
      return renderArray(children, node.text, depth, node.content.readonly === true);
    case "tuple":
      return compilerLines(node.content.expressionText ?? node.text, depth * 2);
    case "details":
      return compilerLines(node.content.expressionText ?? node.text, depth * 2);
    case "atom":
      return compilerLines(node.text, depth * 2);
  }
}

function renderObject(
  children: readonly TypeRenderEdge[],
  depth: number,
  provenance?: string,
): MutableCodeLine[] {
  const baseIndent = depth * 2;
  const lines: MutableCodeLine[] = [line(baseIndent, text("{"))];
  if (provenance !== undefined) {
    lines.push(line(baseIndent + 2, token(`// ${oneLine(provenance)}`, "comment")));
  }
  for (const edge of children.filter((edge) => edge.role !== "typeArgument")) {
    const child = renderNode(edge.node, depth + 1);
    const first = child.shift() ?? line(baseIndent + 2);
    const propertySegments: CodeSegment[] = [
      ...(edge.readonly ? [token("readonly", "keyword"), text(" ")] : []),
      token(edge.label ?? "value", "property"),
    ];
    if (edge.optional === true) {
      propertySegments.push(token("?", "operator"));
    }
    propertySegments.push(token(":", "operator"), text(" "), ...first.segments);
    const propertyLines: MutableCodeLine[] = [line(baseIndent + 2, ...propertySegments), ...child];
    appendSegment(propertyLines.at(-1), text(";"));
    if (edge.annotation !== undefined) {
      appendSegment(propertyLines.at(-1), text(" "), token(`// ${oneLine(edge.annotation)}`, "comment"));
    }
    lines.push(...propertyLines);
  }
  lines.push(line(baseIndent, text("}")));
  return lines;
}

function renderJoined(
  children: readonly TypeRenderEdge[],
  operator: "|" | "&",
  depth: number,
): MutableCodeLine[] {
  const baseIndent = depth * 2;
  if (children.length === 0) {
    return [line(baseIndent, token("never", "keyword"))];
  }
  const lines: MutableCodeLine[] = [];
  for (const edge of children) {
    const child = renderNode(edge.node, depth + 1);
    const first = child.shift() ?? line(baseIndent + 2);
    lines.push(line(baseIndent, token(operator, "operator"), text(" "), ...first.segments), ...child);
  }
  return lines;
}

function renderArray(children: readonly TypeRenderEdge[], fallback: string, depth: number, readonly: boolean): MutableCodeLine[] {
  const baseIndent = depth * 2;
  if (children.length === 0) {
    return compilerLines(fallback, baseIndent);
  }
  const child = renderNode(children[0]!.node, depth + 1);
  child[0]?.segments.unshift(token(readonly ? "ReadonlyArray" : "Array", "type"), text("<"));
  appendSegment(child.at(-1), text(">"));
  if (child[0] !== undefined) {
    child[0] = line(baseIndent, ...child[0].segments);
  }
  return child;
}

function compilerLines(value: string, baseIndent: number): MutableCodeLine[] {
  return value.split(/\r?\n/).map((source) => {
    const leading = source.match(/^[ \t]*/)?.[0] ?? "";
    const leadingColumns = [...leading].reduce((columns, character) => columns + (character === "\t" ? 2 : 1), 0);
    return line(baseIndent + leadingColumns, ...tokenizeTypeScript(source.slice(leading.length)));
  });
}

function appendNote(lines: MutableCodeLine[], note: string | undefined, indentColumns: number): void {
  if (note !== undefined) {
    lines.push(line(indentColumns, token(`/* Note: ${oneLine(note)} */`, "comment")));
  }
}

function isPropertyPosition(
  tokens: ReadonlyArray<{ readonly entry: { readonly kind: SyntaxKind }; readonly index: number }>,
  position: number | undefined,
): boolean {
  if (position === undefined || position === 0) {
    return true;
  }
  const previous = tokens[position - 1]?.entry.kind;
  return previous === SyntaxKind.OpenBraceToken ||
    previous === SyntaxKind.SemicolonToken ||
    previous === SyntaxKind.CommaToken ||
    previous === SyntaxKind.ReadonlyKeyword;
}

function isPropertyToken(kind: SyntaxKind): boolean {
  return kind === SyntaxKind.Identifier || kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NumericLiteral;
}

function isStringToken(kind: SyntaxKind): boolean {
  return kind === SyntaxKind.StringLiteral ||
    kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
    kind === SyntaxKind.TemplateHead ||
    kind === SyntaxKind.TemplateMiddle ||
    kind === SyntaxKind.TemplateTail;
}

function isTrivia(kind: SyntaxKind): boolean {
  return kind === SyntaxKind.WhitespaceTrivia ||
    kind === SyntaxKind.NewLineTrivia ||
    kind === SyntaxKind.SingleLineCommentTrivia ||
    kind === SyntaxKind.MultiLineCommentTrivia;
}

function segmentText(segment: CodeSegment): string {
  switch (segment.kind) {
    case "token":
    case "text":
      return segment.text;
    case "recursive":
      return segment.label;
    case "disclosure":
      return "";
  }
}

function commentLine(value: string): MutableCodeLine {
  return line(0, token(value, "comment"));
}

interface MutableCodeLine extends CodeLine {
  readonly segments: CodeSegment[];
}

function line(indentColumns: number, ...segments: CodeSegment[]): MutableCodeLine {
  return { indentColumns, segments };
}

function text(value: string): CodeSegment {
  return { kind: "text", text: value };
}

function token(value: string, tokenClass: TokenClass): CodeSegment {
  return { kind: "token", text: value, tokenClass };
}

function disclosure(node: TypeRenderNode, state: "collapsed" | "expanded"): CodeSegment {
  return {
    kind: "disclosure",
    nodeId: node.viewNodeId,
    label: `${state === "expanded" ? "Collapse" : "Expand"} ${oneLine(node.text)}`,
    state,
  };
}

function appendSegment(target: MutableCodeLine | undefined, ...segments: CodeSegment[]): void {
  target?.segments.push(...segments);
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
