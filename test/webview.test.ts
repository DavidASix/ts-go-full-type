import { describe, expect, it } from "vitest";
import type { ViewState } from "../src/shared/protocol";
import { webviewHarness } from "./support/webviewHarness";

export const state: ViewState = { kind: "success", rawText: "", result: {
  name: "Example", sourceUri: "file:///types.ts", project: "/tsconfig.json", compilerVersion: "7.0.2", generation: 1,
  root: { viewNodeId: "root", text: "Example", content: { state: "expanded", layout: "object", children: [
    { label: "nested", node: { viewNodeId: "nested", text: "Nested", content: { state: "collapsed", layout: "atom" }} },
    { label: "value", node: { viewNodeId: "value", text: "string", content: { state: "leaf", layout: "atom" }} },
  ] }},
} };

describe("webview tree interactions", () => {
  it("opens an extensible two-item node menu and keeps Cancel second", async () => {
    const h = await webviewHarness(state);
    try {
      const row = h.row("nested");
      row.querySelector<HTMLElement>(".tree-row")!.dispatchEvent(new h.window.MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 12, clientY: 18,
      }));
      const menu = h.document.getElementById("context-menu")!;
      const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      expect(items.map((item) => item.textContent)).toEqual(["Go to Definition", "Cancel"]);
      expect(menu.hidden).toBe(false);
      items[0]!.click();
      expect(menu.hidden).toBe(true);
      expect(h.messages.at(-1)).toEqual({ type: "goToDefinition", viewNodeId: "nested", target: "type" });

      row.querySelector<HTMLElement>(".tree-label")!.dispatchEvent(new h.window.MouseEvent("contextmenu", {
        bubbles: true, cancelable: true,
      }));
      items[0]!.click();
      expect(h.messages.at(-1)).toEqual({ type: "goToDefinition", viewNodeId: "nested", target: "symbol" });

      row.querySelector<HTMLElement>(".tree-row")!.dispatchEvent(new h.window.MouseEvent("contextmenu", {
        bubbles: true, cancelable: true,
      }));
      const messageCount = h.messages.length;
      items[1]!.click();
      expect(menu.hidden).toBe(true);
      expect(h.messages).toHaveLength(messageCount);
    } finally { h.close(); }
  });

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
  it("preserves selection, focus, scrolling, and metadata while another branch expands", async () => {
    const h = await webviewHarness(state);
    try {
      const value = h.row("value");
      value.focus();
      const selectedText = value.querySelector(".tree-description span")!.firstChild!;
      const range = h.document.createRange(); range.selectNodeContents(selectedText);
      const selection = h.window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      expect(selection.toString()).toBe("string");
      const metadata = h.document.querySelector<HTMLDetailsElement>(".metadata")!; metadata.open = true;
      const surface = h.document.querySelector<HTMLElement>(".scroll")!; surface.scrollTop = 80; surface.scrollLeft = 17;
      const expanded: ViewState = { ...state, result: { ...state.result, root: { ...state.result.root, content: {
        state: "expanded", layout: "object", children: [
          { label: "nested", node: { viewNodeId: "nested", text: "Nested", content: { state: "expanded", layout: "object", children: [
            { label: "child", node: { viewNodeId: "child", text: "number", content: { state: "leaf", layout: "atom" } } },
          ] } } },
          state.result.root.content.children![1]!,
        ],
      } } } };
      h.update(expanded);
      expect(h.row("value")).toBe(value);
      expect(h.document.activeElement).toBe(value);
      expect(selection.anchorNode).toBe(selectedText);
      expect(selection.toString()).toBe("string");
      expect(metadata.open).toBe(true);
      expect(surface.scrollTop).toBe(80); expect(surface.scrollLeft).toBe(17);
      h.update(expanded, true);
      expect(h.row("value")).toBe(value);
      expect(selection.toString()).toBe("string");
      expect(h.document.querySelector(".type-tree")?.classList.contains("word-wrap")).toBe(true);
      h.window.dispatchEvent(new h.window.MessageEvent("message", { data: {
        type: "render", generation: "1", html: h.document.getElementById("content")!.innerHTML, paletteCss: "--ft-type: #abcdef;",
      } }));
      expect(h.document.getElementById("theme-palette")?.textContent).toContain("#abcdef");
      expect(selection.toString()).toBe("string");
    } finally { h.close(); }
  });

  it("returns focus to the nearest retained ancestor when a branch is collapsed", async () => {
    const expanded: ViewState = { ...state, result: { ...state.result, root: { ...state.result.root, content: {
      state: "expanded", layout: "object", children: [{ label: "nested", node: {
        viewNodeId: "nested", text: "Nested", content: { state: "expanded", layout: "object", children: [
          { label: "child", node: { viewNodeId: "child", text: "number", content: { state: "leaf", layout: "atom" } } },
        ] },
      } }],
    } } } };
    const h = await webviewHarness(expanded);
    try {
      h.row("child").focus();
      h.update(state);
      expect(h.document.activeElement).toBe(h.row("nested"));
      expect(h.row("nested").getAttribute("aria-expanded")).toBe("false");
    } finally { h.close(); }
  });

  it("resets symbol-local state without taking keyboard focus when the editor changes symbols", async () => {
    const h = await webviewHarness(state);
    try {
      h.document.querySelector<HTMLDetailsElement>(".metadata")!.open = true;
      h.document.querySelector<HTMLElement>(".scroll")!.scrollTop = 80;
      h.row("value").focus();
      h.update({ ...state, result: { ...state.result, generation: 2, name: "Other" } });
      expect(h.document.querySelector<HTMLDetailsElement>(".metadata")!.open).toBe(false);
      expect(h.document.querySelector(".scroll")?.scrollTop).toBe(0);
      expect(h.document.querySelector('[role="tree"]')?.getAttribute("data-generation")).toBe("2");
    } finally { h.close(); }
  });

});
