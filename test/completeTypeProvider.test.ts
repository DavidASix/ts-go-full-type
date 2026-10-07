import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ extensions: { getExtension: vi.fn() } }));

import { SymbolFlags, type Checker, type Symbol as AsyncSymbol, type Type } from "typescript/unstable/async";
import type { Node, TypeNode } from "typescript/unstable/ast";
import { resolveFocusedType } from "../src/native/completeTypeProvider";
import type { SymbolFocus } from "../src/native/focus";

/**
 * Create a focused identifier fixture with optional explicitly associated type syntax.
 * @param typeNode Fixture input used to control the behavior under test.
 */
function focus(typeNode?: TypeNode): SymbolFocus {
  return {
    name: "Selected",
    start: 12,
    end: 20,
    node: {} as Node,
    ...(typeNode === undefined ? {} : { typeNode }),
  };
}

describe("focused type resolution", () => {
  it("resolves alias declarations and type use sites from their type syntax", async () => {
    const expected = { isErrorType: () => false } as Type;
    const typeNode = {} as TypeNode;
    const getTypeFromTypeNode = vi.fn(async () => expected);
    const getTypeAtPosition = vi.fn();
    const getTypeAtLocation = vi.fn();
    const checker = { getTypeFromTypeNode, getTypeAtPosition, getTypeAtLocation } as unknown as Checker;

    await expect(resolveFocusedType(checker, "file:///types.ts", focus(typeNode))).resolves.toBe(expected);
    expect(getTypeFromTypeNode).toHaveBeenCalledWith(typeNode);
    expect(getTypeAtPosition).not.toHaveBeenCalled();
    expect(getTypeAtLocation).not.toHaveBeenCalled();
  });

  it("resolves declarations and use-site identifiers at their semantic position", async () => {
    const expected = { isErrorType: () => false } as Type;
    const getTypeFromTypeNode = vi.fn();
    const getTypeAtPosition = vi.fn(async () => expected);
    const getTypeAtLocation = vi.fn();
    const checker = { getTypeFromTypeNode, getTypeAtPosition, getTypeAtLocation } as unknown as Checker;

    await expect(resolveFocusedType(checker, "file:///types.ts", focus())).resolves.toBe(expected);
    expect(getTypeAtPosition).toHaveBeenCalledWith({ uri: "file:///types.ts" }, 12);
    expect(getTypeFromTypeNode).not.toHaveBeenCalled();
    expect(getTypeAtLocation).not.toHaveBeenCalled();
  });

  it("falls back to the AST node when position lookup returns an error type", async () => {
    const errorType = { isErrorType: () => true } as Type;
    const expected = { isErrorType: () => false } as Type;
    const getTypeAtPosition = vi.fn(async () => errorType);
    const getTypeAtLocation = vi.fn(async () => expected);
    const checker = { getTypeAtPosition, getTypeAtLocation } as unknown as Checker;
    const selected = focus();

    await expect(resolveFocusedType(checker, "file:///types.ts", selected)).resolves.toBe(expected);
    expect(getTypeAtLocation).toHaveBeenCalledWith(selected.node);
  });

  it("falls back to a symbol's declared type when location APIs return errors", async () => {
    const errorType = { isErrorType: () => true } as Type;
    const expected = { isErrorType: () => false } as Type;
    const symbol = { flags: SymbolFlags.Interface } as AsyncSymbol;
    const getTypeAtPosition = vi.fn(async () => errorType);
    const getTypeAtLocation = vi.fn(async () => errorType);
    const getSymbolAtLocation = vi.fn(async () => symbol);
    const getDeclaredTypeOfSymbol = vi.fn(async () => expected);
    const checker = {
      getTypeAtPosition,
      getTypeAtLocation,
      getSymbolAtLocation,
      getDeclaredTypeOfSymbol,
    } as unknown as Checker;

    await expect(resolveFocusedType(checker, "file:///types.ts", focus())).resolves.toBe(expected);
    expect(getDeclaredTypeOfSymbol).toHaveBeenCalledWith(symbol);
  });
});
