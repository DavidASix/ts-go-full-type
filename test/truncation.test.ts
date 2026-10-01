import { describe, expect, it } from "vitest";
import { hasPresentationTruncation } from "../src/native/truncation";

describe("hasPresentationTruncation", () => {
  it("detects TypeScript presentation abbreviations", () => {
    expect(hasPresentationTruncation("{ a: string; ... 12 more ...; }" )).toBe(true);
    expect(hasPresentationTruncation("{ ... }")).toBe(true);
  });

  it("does not reject ordinary rest syntax or recursive names", () => {
    expect(hasPresentationTruncation("(...args: string[]) => void")).toBe(false);
    expect(hasPresentationTruncation("[head: string, ...tail: number[]]")).toBe(false);
    expect(hasPresentationTruncation("RecursiveNode[]")).toBe(false);
  });
});
