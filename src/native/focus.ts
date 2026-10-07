import {
  getTokenAtPosition,
  isIdentifier,
  isTypeAliasDeclaration,
  isTypeReferenceNode,
  SyntaxKind,
  type Node,
  type SourceFile,
  type TypeNode,
} from "typescript/unstable/ast";

export interface SymbolFocus {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly node: Node;
  readonly typeNode?: TypeNode;
}

/**
 * Locate an identifier at the cursor without accepting adjacent punctuation.
 * @param sourceFile Compiler AST containing the editor text.
 * @param offset Zero-based source offset within the selected identifier.
 */
export function findSymbolFocus(sourceFile: SourceFile, offset: number): SymbolFocus | undefined {
  if (offset < 0 || offset >= sourceFile.text.length) {
    return undefined;
  }
  const token = getTokenAtPosition(sourceFile, offset);
  return qualifySymbolToken(sourceFile, token, offset);
}

/**
 * Capture an identifier range and any directly associated type syntax.
 * @param sourceFile Compiler AST containing the editor text.
 * @param token Compiler token under the selected source offset.
 * @param offset Zero-based source offset within the selected identifier.
 */
export function qualifySymbolToken(
  sourceFile: SourceFile,
  token: ReturnType<typeof getTokenAtPosition>,
  offset: number,
): SymbolFocus | undefined {
  if (
    !isIdentifier(token) ||
    offset < token.getStart(sourceFile) ||
    offset >= token.getEnd()
  ) {
    return undefined;
  }
  return {
    name: token.text,
    start: token.getStart(sourceFile),
    end: token.getEnd(),
    node: token,
    ...resolutionTypeNodeForToken(token),
  };
}

/**
 * Associate alias names and qualified references with their own type nodes.
 * @param token Compiler token under the selected source offset.
 */
function resolutionTypeNodeForToken(token: Node): { readonly typeNode?: TypeNode } {
  if (isTypeAliasDeclaration(token.parent) && token.parent.name === token) {
    return { typeNode: token.parent.type };
  }
  let name = token;
  while (name.parent.kind === SyntaxKind.QualifiedName) name = name.parent;
  return isTypeReferenceNode(name.parent) ? { typeNode: name.parent } : {};
}
