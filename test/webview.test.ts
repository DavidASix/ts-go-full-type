import { describe, expect, it } from "vitest";
import type { ViewState } from "../src/shared/protocol";
import { webviewHarness } from "./support/webviewHarness";

export const state: ViewState = { kind: "success", rawText: "", result: {
  name: "Example", sourceUri: "file:///types.ts", project: "/tsconfig.json", compilerVersion: "7.0.2", generation: 1,
  root: { viewNodeId: "root", text: "Example", state: "expanded", layout: "object", children: [
    { label: "nested", node: { viewNodeId: "nested", text: "Nested", state: "collapsed", layout: "atom" } },
    { label: "value", node: { viewNodeId: "value", text: "string", state: "leaf", layout: "atom" } },
  ] },
} };

describe("webview tree interactions", () => {
  it("moves focus through visible rows and posts expansion only for expandable nodes", async () => {
    const h = await webviewHarness(state);
    try {
      const root = h.row("root"); root.focus();
      h.key(root, "ArrowDown");
      expect(h.document.activeElement).toBe(h.row("nested"));
      h.key(h.row("nested"), "ArrowRight");
      expect(h.messages.at(-1)).toEqual({ type: "toggle", viewNodeId: "nested" });
      h.key(h.row("nested"), "End");
      expect(h.document.activeElement).toBe(h.row("value"));
      const count = h.messages.length;
      h.key(h.row("value"), "Enter");
      expect(h.messages).toHaveLength(count);
      h.key(h.row("value"), "ArrowLeft");
      expect(h.document.activeElement).toBe(root);
      expect([...h.document.querySelectorAll('[tabindex="0"]')]).toEqual([root]);
    } finally { h.close(); }
  });

  it("restores focus and scrolling for the same symbol without stealing initial editor focus", async () => {
    const first = await webviewHarness(state);
    let saved: unknown;
    try {
      expect(first.document.activeElement?.getAttribute("role")).not.toBe("treeitem");
      const surface = first.document.querySelector<HTMLElement>(".scroll")!;
      surface.scrollTop = 81; surface.scrollLeft = 22;
      first.row("nested").querySelector<HTMLElement>(".tree-row")!.click();
      saved = first.saved();
    } finally { first.close(); }
    const next = await webviewHarness(state, saved);
    try {
      expect(next.document.activeElement).toBe(next.row("nested"));
      expect(next.document.querySelector(".scroll")?.scrollTop).toBe(81);
      expect(next.document.querySelector(".scroll")?.scrollLeft).toBe(22);
    } finally { next.close(); }
  });
});
