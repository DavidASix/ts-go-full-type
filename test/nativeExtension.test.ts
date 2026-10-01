import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ extensions: { getExtension: vi.fn() } }));

import { validateNativePreviewAPI } from "../src/native/nativeExtension";

describe("native-preview export validation", () => {
  it("accepts only the expected callable boundary", () => {
    const valid = {
      onLanguageServerInitialized: () => ({ dispose() {} }),
      initializeAPIConnection: async () => "/tmp/pipe",
      registerContentMappers: () => ({ dispose() {} }),
    };
    expect(validateNativePreviewAPI(valid)).toBe(valid);
    expect(validateNativePreviewAPI(undefined)).toBeUndefined();
    expect(validateNativePreviewAPI({ ...valid, initializeAPIConnection: "no" })).toBeUndefined();
    expect(validateNativePreviewAPI({ ...valid, registerContentMappers: undefined })).toBeUndefined();
  });
});
