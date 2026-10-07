import * as vscode from "vscode";
import { isRecord } from "../shared/records";
import {
  emptyThemeData,
  mergeThemeData,
  parseThemeData,
  resolveThemeTokenPalette,
  type ThemeData,
  type ThemeTokenPalette,
} from "./themePalette";

interface ThemeContribution {
  readonly id?: string;
  readonly label?: string;
  readonly path?: string;
}

/**
 * Resolve installed theme contributions and fall back gracefully on unreadable themes.
 */
export async function resolveActiveThemeTokenPalette(): Promise<ThemeTokenPalette> {
  const activeTheme = vscode.workspace.getConfiguration("workbench").get<string>("colorTheme");
  if (activeTheme === undefined) {
    return {};
  }
  const contribution = findThemeContribution(activeTheme);
  if (contribution === undefined) {
    return {};
  }
  try {
    const theme = await loadTheme(contribution.uri, new Set<string>());
    return resolveThemeTokenPalette(theme);
  } catch {
    return {};
  }
}

/**
 * Find the installed theme file matching the configured theme ID or label.
 * @param activeTheme Configured installed theme ID or label.
 */
function findThemeContribution(activeTheme: string): { readonly uri: vscode.Uri } | undefined {
  for (const extension of vscode.extensions.all) {
    const packageJson: unknown = extension.packageJSON;
    if (!isRecord(packageJson) || !isRecord(packageJson.contributes)) continue;
    const themes = packageJson.contributes.themes;
    if (!Array.isArray(themes)) {
      continue;
    }
    for (const value of themes) {
      const theme = asThemeContribution(value);
      if (theme?.path === undefined || (theme.id !== activeTheme && theme.label !== activeTheme)) {
        continue;
      }
      return { uri: vscode.Uri.joinPath(extension.extensionUri, theme.path) };
    }
  }
  return undefined;
}

/**
 * Load relative theme includes once per URI and merge local overrides.
 * @param uri Source or theme resource URI.
 * @param visited Theme URIs already loaded during this include chain.
 */
async function loadTheme(uri: vscode.Uri, visited: Set<string>): Promise<ThemeData> {
  const key = uri.toString();
  if (visited.has(key)) {
    return emptyThemeData();
  }
  visited.add(key);
  const bytes = await vscode.workspace.fs.readFile(uri);
  const local = parseThemeData(new TextDecoder().decode(bytes));
  if (local === undefined) {
    return emptyThemeData();
  }
  if (local.include === undefined) {
    return local;
  }
  const inheritedUri = vscode.Uri.joinPath(uri, "..", local.include);
  const inherited = await loadTheme(inheritedUri, visited);
  return mergeThemeData(inherited, local);
}

/**
 * Extract supported contribution fields from an untrusted extension manifest.
 * @param value Untrusted value to validate or normalize.
 */
function asThemeContribution(value: unknown): ThemeContribution | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    ...(typeof value.path === "string" ? { path: value.path } : {}),
  };
}
