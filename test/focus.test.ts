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

  it("captures the enclosing type node at a use site", () => {
    const text = "const value: Example<string> = source;";
    const start = text.indexOf("Example");
    const sourceFile = { text } as SourceFile;
    const root = { kind: SyntaxKind.SourceFile } as Node;
    Object.assign(root, { parent: root });
    const typeNode = { kind: SyntaxKind.TypeReference, parent: root } as Node;
    const token = {
      kind: SyntaxKind.Identifier,
      parent: typeNode,
      text: "Example",
      getStart: () => start,
      getEnd: () => start + "Example".length,
    } as unknown as Node;

    expect(qualifySymbolToken(sourceFile, token, start)?.typeNode).toBe(typeNode);
  });

  it("does not mistake a declaration nested in type syntax for a type reference", () => {
    const text = "type Shape = { value: string };";
    const start = text.indexOf("value");
    const sourceFile = { text } as SourceFile;
    const root = { kind: SyntaxKind.SourceFile } as Node;
    Object.assign(root, { parent: root });
    const typeLiteral = { kind: SyntaxKind.TypeLiteral, parent: root } as Node;
    const property = { kind: SyntaxKind.PropertySignature, parent: typeLiteral } as Node;
    const token = {
      kind: SyntaxKind.Identifier,
      parent: property,
      text: "value",
      getStart: () => start,
      getEnd: () => start + "value".length,
    } as unknown as Node;

    expect(qualifySymbolToken(sourceFile, token, start)?.typeNode).toBeUndefined();
  });

  it("resolves nested declaration names at their own position instead of an outer generic", () => {
    const text = "type Shape = Array<{ value: string }>";
    const start = text.indexOf("value");
    const sourceFile = { text } as SourceFile;
    const outer = { kind: SyntaxKind.TypeReference } as Node;
    const literal = { kind: SyntaxKind.TypeLiteral, parent: outer } as Node;
    const property = { kind: SyntaxKind.PropertySignature, parent: literal } as Node;
    const token = { kind: SyntaxKind.Identifier, text: "value", parent: property,
      getStart: () => start, getEnd: () => start + 5 } as unknown as Node;
    expect(qualifySymbolToken(sourceFile, token, start)?.typeNode).toBeUndefined();
  });

  it("preserves qualified reference instantiation without treating type-query operands as the outer reference", () => {
    const text = "type Shape = Box<typeof source>; type Other = NS.Example<string>";
    const sourceFile = { text } as SourceFile;
    const outer = { kind: SyntaxKind.TypeReference } as Node;
    const query = { kind: SyntaxKind.TypeQuery, parent: outer } as Node;
    const start = text.indexOf("source");
    const operand = { kind: SyntaxKind.Identifier, text: "source", parent: query,
      getStart: () => start, getEnd: () => start + 6 } as unknown as Node;
    expect(qualifySymbolToken(sourceFile, operand, start)?.typeNode).toBeUndefined();

    const reference = { kind: SyntaxKind.TypeReference } as Node;
    const qualified = { kind: SyntaxKind.QualifiedName, parent: reference } as Node;
    const referenceStart = text.indexOf("Example");
    const name = { kind: SyntaxKind.Identifier, text: "Example", parent: qualified,
      getStart: () => referenceStart, getEnd: () => referenceStart + 7 } as unknown as Node;
    expect(qualifySymbolToken(sourceFile, name, referenceStart)?.typeNode).toBe(reference);
  });

  it("rejects non-identifiers and offsets outside the token", () => {
    const text = "const value = 1;";
    const sourceFile = { text } as SourceFile;
    const token = {
      kind: SyntaxKind.NumericLiteral,
      parent: {},
      getStart: () => 14,
      getEnd: () => 15,
    } as unknown as Node;
    expect(qualifySymbolToken(sourceFile, token, 14)).toBeUndefined();
  });
});
