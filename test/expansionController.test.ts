import { describe, expect, it, vi } from "vitest";

const { writeText } = vi.hoisted(() => ({
  writeText: vi.fn(async (_value: string) => undefined),
}));
vi.mock("vscode", () => ({
  env: { clipboard: { writeText } },
  window: { showErrorMessage: vi.fn() },
}));

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
    focus: { name: `Alias${generation}`, start: 0, end: 6, declaration: {} },
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
});
