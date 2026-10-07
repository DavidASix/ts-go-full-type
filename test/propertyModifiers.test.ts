import { describe, expect, it } from "vitest";
import { SymbolFlags, type Symbol as AsyncSymbol } from "typescript/unstable/async";
import { SyntaxKind, type Node } from "typescript/unstable/ast";
import { isReadonlyProperty } from "../src/native/propertyModifiers";

const query = async <T>(operation: () => Promise<T>) => operation();
function property(checkFlags: number, flags = SymbolFlags.Property): AsyncSymbol {
  return { checkFlags, flags, declarations: [{ resolve: async () => ({ modifiers: [{ kind: SyntaxKind.ReadonlyKeyword }] }) as unknown as Node }] } as unknown as AsyncSymbol;
}

describe("semantic property modifiers", () => {
  it("retains explicit and mapped readonly properties", async () => {
    expect(await isReadonlyProperty(property(0), query)).toBe(true);
    expect(await isReadonlyProperty(property((1 << 18) | (1 << 3)), query)).toBe(true);
  });
  it("does not restore readonly removed by a mapped type from its source declaration", async () => {
    expect(await isReadonlyProperty(property(1 << 18), query)).toBe(false);
  });
  it("marks getter-only properties readonly but preserves writable accessors", async () => {
    const getter = { flags: SymbolFlags.GetAccessor, checkFlags: 0, declarations: [] } as unknown as AsyncSymbol;
    const writable = { ...getter, flags: SymbolFlags.GetAccessor | SymbolFlags.SetAccessor } as unknown as AsyncSymbol;
    expect(await isReadonlyProperty(getter, query)).toBe(true);
    expect(await isReadonlyProperty(writable, query)).toBe(false);
  });
});
