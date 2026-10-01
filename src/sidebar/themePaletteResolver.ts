import * as vscode from "vscode";
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

function findThemeContribution(activeTheme: string): { readonly uri: vscode.Uri } | undefined {
  for (const extension of vscode.extensions.all) {
    const packageJson = asRecord(extension.packageJSON);
    const contributes = asRecord(packageJson?.contributes);
    const themes = contributes?.themes;
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

function asThemeContribution(value: unknown): ThemeContribution | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.label === "string" ? { label: record.label } : {}),
    ...(typeof record.path === "string" ? { path: record.path } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
