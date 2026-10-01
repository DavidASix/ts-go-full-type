import { describe, expect, it } from "vitest";
import { SyntaxKind, type Node, type SourceFile } from "typescript/unstable/ast";
import { qualifyAliasToken } from "../src/native/focus";

function aliasToken(text: string, name: string): { sourceFile: SourceFile; token: Node } {
  const start = text.indexOf(name);
  const sourceFile = { text } as SourceFile;
  const declaration = { kind: SyntaxKind.TypeAliasDeclaration } as { kind: SyntaxKind; name?: Node };
  const token = {
    kind: SyntaxKind.Identifier,
    parent: declaration,
    text: name,
    getStart: () => start,
    getEnd: () => start + name.length,
  } as unknown as Node;
  declaration.name = token;
  return { sourceFile, token };
}

describe("alias focus qualification", () => {
  it("accepts UTF-16 offsets on the declared alias identifier only", () => {
    const text = "/* 😀 */ type Example = string;";
    const { sourceFile, token } = aliasToken(text, "Example");
    const start = text.indexOf("Example");
    expect(start).toBe(14); // The astral character occupies two UTF-16 code units.
    expect(qualifyAliasToken(sourceFile, token, start)?.name).toBe("Example");
    expect(qualifyAliasToken(sourceFile, token, start + 6)?.name).toBe("Example");
    expect(qualifyAliasToken(sourceFile, token, start + 7)).toBeUndefined();
  });

  it("rejects identifier uses and non-alias declarations", () => {
    const { sourceFile, token } = aliasToken("type Example = string;", "Example");
    const start = sourceFile.text.indexOf("Example");
    const differentName = { ...token } as Node;
    const parent = { kind: SyntaxKind.InterfaceDeclaration, name: token };
    const wrongParent = { ...token, parent } as unknown as Node;
    expect(qualifyAliasToken(sourceFile, differentName, start)).toBeUndefined();
    expect(qualifyAliasToken(sourceFile, wrongParent, start)).toBeUndefined();
  });
});
