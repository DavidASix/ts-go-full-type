import { describe, expect, it, vi } from "vitest";
const configuration = vi.hoisted(() => ({ subscribe: vi.fn(() => ({ dispose: vi.fn() })) }));
vi.mock("vscode", () => ({
  workspace: { onDidChangeConfiguration: configuration.subscribe },
  Uri: { joinPath: (_base: unknown, ...parts: string[]) => ({ toString: () => parts.join("/") }) },
}));
vi.mock("../src/sidebar/themePaletteResolver", () => ({ resolveActiveThemeTokenPalette: async () => ({}) }));
import type * as vscode from "vscode";
import { FullTypeViewProvider } from "../src/sidebar/fullTypeViewProvider";

/**
 * Create an attachable view transport for lifecycle and render-message tests.
 */
function view() {
  const listeners = new Map<string, (value?: unknown) => void>();
  const subscribe = (name: string) => (listener: (value?: unknown) => void) => {
    listeners.set(name, listener); return { dispose: () => listeners.delete(name) };
  };
  const documents: string[] = [];
  const webview = {
    set html(value: string) { documents.push(value); },
    postMessage: vi.fn(async (_value: unknown) => true),
    asWebviewUri: (uri: unknown) => uri,
    cspSource: "vscode-webview:",
    onDidReceiveMessage: subscribe("message"),
  };
  const value = { visible: true, webview, onDidChangeVisibility: subscribe("visibility"), onDidDispose: subscribe("dispose") } as unknown as vscode.WebviewView;
  return { value, webview, documents, listeners };
}

describe("persistent webview ownership", () => {
  it("creates one document and sends the latest state after the ready handshake", async () => {
    const events = { onVisibilityChanged: vi.fn(), onToggle: vi.fn() };
    const provider = new FullTypeViewProvider({} as vscode.Uri, events, false);
    const h = view(); provider.resolveWebviewView(h.value);
    provider.setState({ kind: "loading", message: "Resolving <Symbol>" });
    expect(h.documents).toHaveLength(1);
    expect(h.webview.postMessage).not.toHaveBeenCalled();
    h.listeners.get("message")!({ type: "ready" });
    expect(h.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "render", html: expect.stringContaining("&lt;Symbol&gt;") }));
    provider.setState({ kind: "error", message: "retry" });
    provider.setWordWrap(true);
    await Promise.resolve();
    expect(h.documents).toHaveLength(1);
    h.listeners.get("message")!({ type: "toggle", viewNodeId: "node" });
    expect(events.onToggle).toHaveBeenCalledWith("node");
    provider.dispose();
    expect(h.listeners.size).toBe(0);
  });

  it("releases old view subscriptions and waits for each replacement document to be ready", () => {
    const provider = new FullTypeViewProvider({} as vscode.Uri, { onVisibilityChanged: vi.fn(), onToggle: vi.fn() }, false);
    const first = view(); provider.resolveWebviewView(first.value);
    first.listeners.get("message")!({ type: "ready" });
    const next = view(); provider.resolveWebviewView(next.value);
    expect(first.listeners.size).toBe(0);
    provider.setState({ kind: "loading", message: "latest" });
    expect(next.webview.postMessage).not.toHaveBeenCalled();
    next.listeners.get("message")!({ type: "ready" });
    expect(next.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ html: expect.stringContaining("latest") }));
    provider.dispose();
  });
});
