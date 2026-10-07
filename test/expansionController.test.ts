import { describe, expect, it, vi } from "vitest";

const { writeText } = vi.hoisted(() => ({
  writeText: vi.fn(async (_value: string) => undefined),
}));
vi.mock("vscode", () => ({
  env: { clipboard: { writeText } },
  window: { showErrorMessage: vi.fn() },
}));

import { deferred } from "./support/deferred";
import { UserVisibleError } from "../src/shared/errors";
import { ExpansionController } from "../src/controller/expansionController";
import type { ResolvedCompleteType } from "../src/native/completeTypeProvider";
import type { TypeGraph } from "../src/native/typeGraph";
import type { CompleteTypeResult, ViewState } from "../src/shared/protocol";
import type { FullTypeViewProvider } from "../src/sidebar/fullTypeViewProvider";

function result(generation: number): CompleteTypeResult {
  return {
    name: `Alias${generation}`,
    compilerVersion: "7.0.2",
    sourceUri: "file:///types.ts",
    project: "/tsconfig.json",
    generation,
    root: { viewNodeId: "", text: "string", state: "expanded", layout: "atom", children: [] },
  };
}

function session(generation: number) {
  const dispose = vi.fn(async () => undefined);
  const graph = {
    toggle: vi.fn(async () => undefined),
    expandFrontier: vi.fn(async () => undefined),
    collapseAll: vi.fn(),
  } as unknown as TypeGraph;
  const value = {
    result: result(generation),
    graph,
    focus: { name: `Alias${generation}`, start: 0, end: 6, node: {} },
    dispose,
  } as unknown as ResolvedCompleteType;
  return { value, dispose, graph };
}

describe("ExpansionController", () => {
  it("disposes the prior snapshot session when a new result replaces it", async () => {
    let state: ViewState = { kind: "idle", message: "idle" };
    const view = {
      setState: (next: ViewState) => { state = next; },
      getState: () => state,
    } as FullTypeViewProvider;
    const controller = new ExpansionController(view);
    const first = session(1);
    const second = session(2);
    await controller.replace(first.value);
    await controller.replace(second.value);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).not.toHaveBeenCalled();
    expect(state.kind).toBe("success");
    await controller.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it("copies the current expanded raw TypeScript and never HTML", async () => {
    const current = session(3);
    let state: ViewState = { kind: "idle", message: "idle" };
    const view = {
      setState: (next: ViewState) => { state = next; },
      getState: () => state,
    } as FullTypeViewProvider;
    const controller = new ExpansionController(view);
    await controller.replace(current.value);
    await controller.copy();
    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0]![0];
    expect(copied).toContain("type Alias3");
    expect(copied).not.toContain("<button");
  });
  it("does not publish an old expansion failure after its session has been replaced", async () => {
    let state: ViewState = { kind: "idle", message: "idle" };
    const view = { setState: (next: ViewState) => { state = next; }, getState: () => state };
    const controller = new ExpansionController(view);
    const first = session(1);
    const second = session(2);
    const pending = deferred<void>();
    vi.spyOn(first.graph, "toggle").mockReturnValueOnce(pending.promise);
    await controller.replace(first.value);
    const expanding = controller.toggle("old-node");
    await controller.replace(second.value);
    pending.reject(new Error("socket closed"));
    await expanding;
    expect(state).toMatchObject({ kind: "success", result: { name: "Alias2" } });
    await controller.dispose();
  });

  it("keeps the current type usable after a rejected expansion and runs breadth and collapse commands", async () => {
    let state: ViewState = { kind: "idle", message: "idle" };
    const view = { setState: (next: ViewState) => { state = next; }, getState: () => state };
    const controller = new ExpansionController(view);
    const current = session(1);
    vi.spyOn(current.graph, "toggle").mockRejectedValueOnce(new UserVisibleError("node limit"));
    await controller.replace(current.value);
    await controller.toggle("node");
    expect(state).toMatchObject({ kind: "success", notice: "node limit" });
    await controller.expandLevel();
    expect(current.graph.expandFrontier).toHaveBeenCalledOnce();
    await controller.collapseAll();
    expect(current.graph.collapseAll).toHaveBeenCalledOnce();
    expect(state).not.toHaveProperty("notice");
    await controller.dispose();
  });

});
