import { describe, expect, it } from "vitest";
import { hasPresentationTruncation } from "../src/native/truncation";

describe("hasPresentationTruncation", () => {
  it("detects TypeScript presentation abbreviations", () => {
    expect(hasPresentationTruncation("{ a: string; ... 12 more ...; }" )).toBe(true);
    expect(hasPresentationTruncation("{ ... }")).toBe(true);
  });

  it.each([
    '"{ ... }"',
    "'{ ... }'",
    '{ "... 12 more ...": string }',
    '`prefix { ... }`',
    '`prefix ${string} { ... }`',
    '`outer ${`inner ${string} ... 12 more ...`} { ... }`',
    '`prefix ${{ value: string }} ... 12 more ...`',
    '"escaped \\" { ... }"',
  ])("accepts marker-like text inside literal tokens: %s", (text) => {
    expect(hasPresentationTruncation(text)).toBe(false);
  });

  it("still rejects a real marker next to a marker-like literal", () => {
    expect(hasPresentationTruncation('{ safe: "{ ... }"; ... 2 more ... }')).toBe(true);
  });

  it("does not reject ordinary rest syntax or recursive names", () => {
    expect(hasPresentationTruncation("(...args: string[]) => void")).toBe(false);
    expect(hasPresentationTruncation("[head: string, ...tail: number[]]")).toBe(false);
    expect(hasPresentationTruncation("RecursiveNode[]")).toBe(false);
  });
});
