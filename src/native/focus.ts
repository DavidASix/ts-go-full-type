import {
  getTokenAtPosition,
  isIdentifier,
  isTypeAliasDeclaration,
  type SourceFile,
  type TypeAliasDeclaration,
} from "typescript/unstable/ast";

export interface AliasFocus {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly declaration: TypeAliasDeclaration;
}

export function findAliasFocus(sourceFile: SourceFile, offset: number): AliasFocus | undefined {
  if (offset < 0 || offset >= sourceFile.text.length) {
    return undefined;
  }
  const token = getTokenAtPosition(sourceFile, offset);
  return qualifyAliasToken(sourceFile, token, offset);
}

export function qualifyAliasToken(
  sourceFile: SourceFile,
  token: ReturnType<typeof getTokenAtPosition>,
  offset: number,
): AliasFocus | undefined {
  if (
    !isIdentifier(token) ||
    !isTypeAliasDeclaration(token.parent) ||
    token.parent.name !== token ||
    offset < token.getStart(sourceFile) ||
    offset >= token.getEnd()
  ) {
    return undefined;
  }
  return {
    name: token.text,
    start: token.getStart(sourceFile),
    end: token.getEnd(),
    declaration: token.parent,
  };
}
