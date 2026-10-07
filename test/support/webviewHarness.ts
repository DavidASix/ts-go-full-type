import { vi } from "vitest";
import { JSDOM } from "jsdom";
import { renderHtml, renderViewContent, renderPaletteProperties } from "../../src/sidebar/renderHtml";
import type { ViewState } from "../../src/shared/protocol";

/**
 * Run the actual webview script in a DOM with a controllable VS Code message transport.
 * @param state Resolution or disclosure state to present.
 * @param saved Previously persisted webview navigation state.
 */
export async function webviewHarness(state: ViewState, saved?: unknown) {
  let persisted = saved;
  const messages: unknown[] = [];
  const dom = new JSDOM(renderHtml(state, { nonce: "test", cspSource: "", scriptUri: { toString: () => "/webview.js" } as never }), { runScripts: "outside-only", pretendToBeVisual: true, url: "https://full-type-viewer.test" });
  const window = dom.window;
  Object.assign(window, { acquireVsCodeApi: () => ({
    getState: () => persisted,
    setState: (value: unknown) => { persisted = value; },
    postMessage: (value: unknown) => messages.push(value),
  }) });
  vi.resetModules();
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Element", window.Element);
  vi.stubGlobal("Node", window.Node);
  vi.stubGlobal("acquireVsCodeApi", (window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi);
  await import("../../src/sidebar/webview");
  const document = window.document;
  const row = (id: string) => [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((item) => item.dataset.nodeId === id)!;
  return { window, document, messages, row, saved: () => persisted,
    update: (next: ViewState, wordWrap = false) => window.dispatchEvent(new window.MessageEvent("message", { data: {
      type: "render", html: renderViewContent(next, wordWrap), paletteCss: renderPaletteProperties({}),
      generation: next.kind === "success" ? String(next.result.generation) : "",
    } })),
    key: (item: HTMLElement, key: string) => item.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })),
    close: () => { window.close(); vi.unstubAllGlobals(); },
  };
}
