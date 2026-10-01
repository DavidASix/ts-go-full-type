import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/shared/protocol";

describe("parseWebviewMessage", () => {
  it("accepts only the two narrow host messages", () => {
    expect(parseWebviewMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseWebviewMessage({ type: "toggle", viewNodeId: "4:2" })).toEqual({ type: "toggle", viewNodeId: "4:2" });
    expect(parseWebviewMessage({ type: "toggle", viewNodeId: "" })).toBeUndefined();
    expect(parseWebviewMessage({ type: "toggle", viewNodeId: "4:2", projectId: 1 })).toBeUndefined();
    expect(parseWebviewMessage({ type: "request", method: "type" })).toBeUndefined();
  });
});
