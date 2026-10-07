import { createScanner, SyntaxKind } from "typescript/unstable/ast";

const MORE_MARKER = /\.\.\.\s+\d+\s+more\s+\.\.\./;
const EMPTY_OBJECT_MARKER = /\{\s*\.\.\.\s*\}/;

/** Reject compiler abbreviations without mistaking string or template literal contents for presentation markers. */
export function hasPresentationTruncation(text: string): boolean {
  const scanner = createScanner(false, undefined, text);
  const templateBraces: number[] = [];
  const outsideLiterals: string[] = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (kind === SyntaxKind.OpenBraceToken && templateBraces.length > 0) {
      templateBraces[templateBraces.length - 1]! += 1;
    } else if (kind === SyntaxKind.CloseBraceToken && templateBraces.length > 0) {
      if (templateBraces.at(-1) === 0) kind = scanner.reScanTemplateToken(false);
      else templateBraces[templateBraces.length - 1]! -= 1;
    }
    if (kind === SyntaxKind.TemplateHead) templateBraces.push(0);
    if (kind === SyntaxKind.TemplateTail) templateBraces.pop();
    const literal = kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
      kind === SyntaxKind.TemplateHead || kind === SyntaxKind.TemplateMiddle || kind === SyntaxKind.TemplateTail;
    outsideLiterals.push(literal ? " " : scanner.getTokenText());
  }
  const expression = outsideLiterals.join("");
  return MORE_MARKER.test(expression) || EMPTY_OBJECT_MARKER.test(expression);
}
