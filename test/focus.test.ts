import { describe, expect, it } from "vitest";
import { SyntaxKind, type Node, type SourceFile } from "typescript/unstable/ast";
import { qualifySymbolToken } from "../src/native/focus";

function aliasToken(text: string, name: string): { sourceFile: SourceFile; token: Node } {
  const start = text.indexOf(name);
  const sourceFile = { text } as SourceFile;
  const type = { kind: SyntaxKind.StringKeyword } as Node;
  const declaration = { kind: SyntaxKind.TypeAliasDeclaration, type } as {
    kind: SyntaxKind;
    name?: Node;
    type: Node;
  };
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

describe("symbol focus qualification", () => {
  it("accepts UTF-16 offsets on a declared alias identifier", () => {
    const text = "/* 😀 */ type Example = string;";
    const { sourceFile, token } = aliasToken(text, "Example");
    const start = text.indexOf("Example");
    expect(start).toBe(14); // The astral character occupies two UTF-16 code units.
    const focus = qualifySymbolToken(sourceFile, token, start);
    expect(focus?.name).toBe("Example");
    expect(focus?.typeNode).toBe((token.parent as unknown as { type: Node }).type);
    expect(qualifySymbolToken(sourceFile, token, start + 6)?.name).toBe("Example");
    expect(qualifySymbolToken(sourceFile, token, start + 7)).toBeUndefined();
  });

  it("accepts identifier uses and non-alias declarations for position-based resolution", () => {
    const { sourceFile, token } = aliasToken("type Example = string;", "Example");
    const start = sourceFile.text.indexOf("Example");
    const differentName = { ...token } as Node;
    const parent = { kind: SyntaxKind.InterfaceDeclaration, name: token };
    const wrongParent = { ...token, parent } as unknown as Node;
    expect(qualifySymbolToken(sourceFile, differentName, start)?.name).toBe("Example");
    expect(qualifySymbolToken(sourceFile, wrongParent, start)).toMatchObject({
      name: "Example",
      node: wrongParent,
    });
    expect(qualifySymbolToken(sourceFile, wrongParent, start)?.typeNode).toBeUndefined();
  });
});
