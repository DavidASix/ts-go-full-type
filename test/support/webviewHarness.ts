import { vi } from "vitest";
import { JSDOM } from "jsdom";
import { renderHtml } from "../../src/sidebar/renderHtml";
import type { ViewState } from "../../src/shared/protocol";

export async function webviewHarness(state: ViewState, saved?: unknown) {
  let persisted = saved;
  const messages: unknown[] = [];
  const dom = new JSDOM(renderHtml(state, { nonce: "test", cspSource: "", scriptUri: { toString: () => "/webview.js" } as never }), { runScripts: "outside-only", pretendToBeVisual: true });
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
  vi.stubGlobal("acquireVsCodeApi", (window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi);
  await import("../../src/sidebar/webview");
  const document = window.document;
  const row = (id: string) => [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((item) => item.dataset.nodeId === id)!;
  return { window, document, messages, row, saved: () => persisted,
    key: (item: HTMLElement, key: string) => item.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })),
    close: () => { window.close(); vi.unstubAllGlobals(); },
  };
}
