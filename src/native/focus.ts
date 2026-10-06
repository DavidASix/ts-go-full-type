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

export function findSymbolFocus(sourceFile: SourceFile, offset: number): SymbolFocus | undefined {
  if (offset < 0 || offset >= sourceFile.text.length) {
    return undefined;
  }
  const token = getTokenAtPosition(sourceFile, offset);
  return qualifySymbolToken(sourceFile, token, offset);
}

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

function resolutionTypeNodeForToken(token: Node): { readonly typeNode?: TypeNode } {
  if (isTypeAliasDeclaration(token.parent) && token.parent.name === token) {
    return { typeNode: token.parent.type };
  }
  for (let current: Node | undefined = token.parent; current !== undefined; current = current.parent) {
    if (isTypeReferenceNode(current)) {
      return { typeNode: current };
    }
    if (current.kind === SyntaxKind.SourceFile || current.parent === current) {
      break;
    }
  }
  return {};
}
