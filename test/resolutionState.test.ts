import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameCachedSymbol, ResolutionGeneration } from "../src/controller/resolutionState";

afterEach(() => vi.useRealTimers());

describe("resolution state", () => {
  it("debounces to the latest scheduled action", () => {
    vi.useFakeTimers();
    const state = new ResolutionGeneration();
    const calls: number[] = [];
    state.invalidate();
    state.schedule(250, (generation) => calls.push(generation));
    state.invalidate();
    state.schedule(250, (generation) => calls.push(generation));
    vi.advanceTimersByTime(249);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([2]);
  });

  it("suppresses stale generations", () => {
    const state = new ResolutionGeneration();
    const first = state.invalidate();
    expect(state.isCurrent(first)).toBe(true);
    state.invalidate();
    expect(state.isCurrent(first)).toBe(false);
  });

  it("caches only cursor moves within the same symbol and document version", () => {
    const cache = { uri: "file:///types.ts", version: 3, start: 10, end: 17 };
    expect(isSameCachedSymbol(cache, cache.uri, 3, 10)).toBe(true);
    expect(isSameCachedSymbol(cache, cache.uri, 3, 16)).toBe(true);
    expect(isSameCachedSymbol(cache, cache.uri, 3, 17)).toBe(false);
    expect(isSameCachedSymbol(cache, cache.uri, 4, 12)).toBe(false);
    expect(isSameCachedSymbol(cache, "file:///other.ts", 3, 12)).toBe(false);
  });
});
