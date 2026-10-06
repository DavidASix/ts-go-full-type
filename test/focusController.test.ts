import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import type * as vscode from "vscode";
import { selectedSymbolOffset } from "../src/controller/focusController";

function editor(start: number, end: number, wordStart = 2, wordEnd = 8): vscode.TextEditor {
  const position = (character: number) => ({ line: 0, character }) as vscode.Position;
  return {
    document: {
      offsetAt: (value: vscode.Position) => value.character,
      getWordRangeAtPosition: () => ({ start: position(wordStart), end: position(wordEnd) }),
    },
    selection: {
      isEmpty: start === end,
      active: position(end),
      start: position(start),
      end: position(end),
    },
  } as unknown as vscode.TextEditor;
}

describe("selected symbol offset", () => {
  it("uses the caret for an empty selection", () => {
    expect(selectedSymbolOffset(editor(5, 5))).toBe(5);
  });

  it("accepts a whole or partial single-identifier selection", () => {
    expect(selectedSymbolOffset(editor(2, 8))).toBe(2);
    expect(selectedSymbolOffset(editor(3, 6))).toBe(3);
  });

  it("rejects a selection spanning beyond one identifier", () => {
    expect(selectedSymbolOffset(editor(2, 9))).toBeUndefined();
  });
});
