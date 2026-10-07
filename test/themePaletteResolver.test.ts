import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  activeTheme: undefined as string | undefined,
  extensions: [] as Array<{ packageJSON: unknown; extensionUri: URL }>,
  files: new Map<string, string | Error>(),
  reads: vi.fn(),
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({ get: () => host.activeTheme }),
    fs: { readFile: async (uri: URL) => {
      host.reads(uri.toString());
      const file = host.files.get(uri.toString());
      if (file instanceof Error) throw file;
      if (file === undefined) throw new Error("Missing fixture file");
      return new TextEncoder().encode(file);
    } },
  },
  extensions: { get all() { return host.extensions; } },
  Uri: { joinPath: (base: URL, ...parts: string[]) => new URL(parts.join("/"), `${base.toString().replace(/\/$/, "")}/`) },
}));

import { resolveActiveThemeTokenPalette } from "../src/sidebar/themePaletteResolver";

beforeEach(() => {
  host.activeTheme = "Installed Theme";
  host.extensions = [{
    extensionUri: new URL("file:///extensions/theme"),
    packageJSON: { contributes: { themes: [{ id: "Installed Theme", label: "Theme Label", path: "themes/current.json" }] } },
  }];
  host.files.clear();
  host.reads.mockClear();
});

describe("active theme loading", () => {
  it("loads the installed contribution by ID and resolves relative includes with local overrides", async () => {
    host.files.set("file:///extensions/theme/themes/current.json", JSON.stringify({
      include: "../base/base.json",
      semanticTokenColors: { keyword: "#aabbcc" },
      tokenColors: [{ scope: "string", settings: { foreground: "#456" } }],
    }));
    host.files.set("file:///extensions/theme/base/base.json", JSON.stringify({
      semanticTokenColors: { keyword: "#123", type: "#789" },
      tokenColors: [{ scope: "string", settings: { foreground: "#abc" } }, { scope: "comment", settings: { foreground: "#def" } }],
    }));
    expect(await resolveActiveThemeTokenPalette()).toEqual({ keyword: "#aabbcc", type: "#789", string: "#456", comment: "#def" });
  });

  it("matches contribution labels and ignores malformed extension metadata", async () => {
    host.activeTheme = "Theme Label";
    host.extensions.unshift(
      { extensionUri: new URL("file:///bad/null"), packageJSON: null },
      { extensionUri: new URL("file:///bad/array"), packageJSON: { contributes: [] } },
      { extensionUri: new URL("file:///bad/themes"), packageJSON: { contributes: { themes: [null, [], { label: "Theme Label", path: 1 }] } } },
    );
    host.files.set("file:///extensions/theme/themes/current.json", '{"semanticTokenColors":{"number":"#1234"}}');
    expect(await resolveActiveThemeTokenPalette()).toEqual({ number: "#1234" });
  });

  it.each([undefined, "Uninstalled Theme"])("falls back without file access for unavailable configuration %s", async (activeTheme) => {
    host.activeTheme = activeTheme;
    expect(await resolveActiveThemeTokenPalette()).toEqual({});
    expect(host.reads).not.toHaveBeenCalled();
  });

  it("terminates cyclic includes while retaining each theme's local colors", async () => {
    host.files.set("file:///extensions/theme/themes/current.json", '{"include":"base.json","semanticTokenColors":{"type":"#123"}}');
    host.files.set("file:///extensions/theme/themes/base.json", '{"include":"current.json","semanticTokenColors":{"string":"#456"}}');
    expect(await resolveActiveThemeTokenPalette()).toEqual({ type: "#123", string: "#456" });
    expect(host.reads).toHaveBeenCalledTimes(2);
  });

  it.each(["{broken json", "null", "[]"])("falls back for malformed theme data %s", async (source) => {
    host.files.set("file:///extensions/theme/themes/current.json", source);
    expect(await resolveActiveThemeTokenPalette()).toEqual({});
  });

  it("keeps local colors when an included theme has malformed data", async () => {
    host.files.set("file:///extensions/theme/themes/current.json", '{"include":"base.json","semanticTokenColors":{"type":"#123"}}');
    host.files.set("file:///extensions/theme/themes/base.json", "broken");
    expect(await resolveActiveThemeTokenPalette()).toEqual({ type: "#123" });
  });

  it.each(["current.json", "base.json"])("falls back after a file read failure in %s", async (failedFile) => {
    host.files.set("file:///extensions/theme/themes/current.json", '{"include":"base.json","semanticTokenColors":{"type":"#123"}}');
    host.files.set(`file:///extensions/theme/themes/${failedFile}`, new Error("Unreadable fixture"));
    expect(await resolveActiveThemeTokenPalette()).toEqual({});
  });
});
