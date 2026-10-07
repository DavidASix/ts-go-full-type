import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const editorEvents = vi.hoisted(() => {
  const listeners = new Map<string, (...args: any[]) => void>();
  const subscribe = (name: string) => (listener: (...args: any[]) => void) => {
    listeners.set(name, listener);
    return { dispose: () => listeners.delete(name) };
  };
  const window = {
    activeTextEditor: undefined as any,
    onDidChangeActiveTextEditor: subscribe("active"),
    onDidChangeTextEditorSelection: subscribe("selection"),
    showErrorMessage: vi.fn(),
  };
  return { listeners, window, workspace: { onDidChangeTextDocument: subscribe("edit") } };
});
vi.mock("vscode", () => editorEvents);
import type * as vscode from "vscode";
import { FocusController } from "../src/controller/focusController";
import { ExpansionController } from "../src/controller/expansionController";
import type { ResolveRequest, ResolvedCompleteType } from "../src/native/completeTypeProvider";
import type { ViewState } from "../src/shared/protocol";
import { deferred } from "./support/deferred";

function session(request: ResolveRequest): ResolvedCompleteType {
  return {
    result: { name: request.offset < 5 ? "First" : "Second", generation: request.generation, compilerVersion: "7.0.2", sourceUri: request.uri, project: "/tsconfig.json", root: { text: "string", viewNodeId: "leaf", content: { state: "leaf", layout: "atom" }} },
    focus: { start: request.offset < 5 ? 0 : 6, end: request.offset < 5 ? 5 : 12, name: "symbol", node: {} },
    graph: {}, dispose: vi.fn(async () => undefined),
  } as unknown as ResolvedCompleteType;
}
function setup() {
  let text = "First Second";
  let offset = 0;
  const document = { uri: { scheme: "file", toString: () => "file:///types.ts" }, languageId: "typescript", version: 1,
    getText: (range?: unknown) => range ? "symbol" : text,
    positionAt: (value: number) => ({ line: 0, character: value }),
    offsetAt: (value: vscode.Position) => value.character,
    getWordRangeAtPosition: () => ({}),
  };
  const editor = { document, selections: [{}], get selection() { return { isEmpty: true, active: { line: 0, character: offset } }; } };
  editorEvents.window.activeTextEditor = editor;
  let state: ViewState = { kind: "idle", message: "idle" };
  const view = { visible: true, setState: vi.fn((next: ViewState) => { state = next; }), getState: () => state };
  let invalidate!: () => void;
  const provider = { resolve: vi.fn(async (request: ResolveRequest): Promise<ResolvedCompleteType | undefined> => session(request)),
    onDidInvalidate: (listener: () => void) => { invalidate = listener; return { dispose() {} }; },
  };
  const expansion = new ExpansionController(view);
  const controller = new FocusController(provider, expansion, view);
  return { controller, provider, view, expansion, document, invalidate: () => invalidate(),
    move: (value: number) => { offset = value; editorEvents.listeners.get("selection")!({ textEditor: editor }); },
    edit: (value: string) => { text = value; document.version++; editorEvents.listeners.get("edit")!({ document }); },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { editorEvents.listeners.clear(); vi.useRealTimers(); });

describe("focus lifecycle", () => {
  it("debounces to the latest caret and skips cached moves within its identifier", async () => {
    const h = setup();
    h.move(0); h.move(6);
    await vi.advanceTimersByTimeAsync(249);
    expect(h.provider.resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.provider.resolve).toHaveBeenCalledOnce();
    expect(h.view.getState()).toMatchObject({ kind: "success", result: { name: "Second" } });
    h.move(8);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.provider.resolve).toHaveBeenCalledOnce();
    h.controller.dispose();
    await h.expansion.dispose();
  });

  it("hiding cancels a pending request and releases its late session without restoring the view", async () => {
    const h = setup();
    const pending = deferred<ResolvedCompleteType>();
    h.provider.resolve.mockImplementationOnce(() => pending.promise);
    h.move(0);
    await vi.advanceTimersByTimeAsync(250);
    const request = h.provider.resolve.mock.calls[0]![0];
    h.view.visible = false;
    h.controller.onVisibilityChanged(false);
    expect(request.signal.aborted).toBe(true);
    const late = session(request);
    pending.resolve(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.dispose).toHaveBeenCalledOnce();
    expect(h.view.getState().kind).not.toBe("success");
    h.controller.dispose();
  });

  it("a newer result cannot be overwritten by an older completion", async () => {
    const h = setup();
    const pending = deferred<ResolvedCompleteType>();
    h.provider.resolve.mockImplementationOnce(() => pending.promise);
    h.move(0);
    await vi.advanceTimersByTimeAsync(250);
    const request = h.provider.resolve.mock.calls[0]![0];
    h.move(6);
    await vi.advanceTimersByTimeAsync(250);
    const old = session(request);
    pending.resolve(old);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.view.getState()).toMatchObject({ kind: "success", result: { name: "Second" } });
    expect(old.dispose).toHaveBeenCalledOnce();
    h.controller.dispose(); await h.expansion.dispose();
  });

  it("restart and explicit refresh bypass the same-symbol cache and dispose old sessions", async () => {
    const h = setup();
    h.move(0); await vi.advanceTimersByTimeAsync(250);
    const first = h.expansion.current()!;
    h.invalidate(); await vi.advanceTimersByTimeAsync(0);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(h.provider.resolve).toHaveBeenCalledTimes(2);
    h.controller.refresh(); await vi.advanceTimersByTimeAsync(0);
    expect(h.provider.resolve).toHaveBeenCalledTimes(3);
    h.controller.dispose(); await h.expansion.dispose();
  });

  it("captures text and version and invalidates them immediately on edits", async () => {
    const h = setup();
    h.move(0); await vi.advanceTimersByTimeAsync(250);
    const oldRequest = h.provider.resolve.mock.calls[0]![0];
    h.edit("First Changed");
    expect(oldRequest.text).toBe("First Second");
    expect(oldRequest.version).toBe(1);
    expect(oldRequest.signal.aborted).toBe(true);
    expect(h.expansion.current()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.provider.resolve.mock.calls[1]![0]).toMatchObject({ text: "First Changed", version: 2 });
    h.controller.dispose(); await h.expansion.dispose();
  });

  it("does no semantic work for hidden views or ineligible editors", async () => {
    const h = setup();
    h.view.visible = false; h.move(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.provider.resolve).not.toHaveBeenCalled();
    h.view.visible = true; h.document.languageId = "javascript"; h.move(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.provider.resolve).not.toHaveBeenCalled();
    expect(h.view.getState().kind).toBe("idle");
    h.controller.dispose();
  });
});
