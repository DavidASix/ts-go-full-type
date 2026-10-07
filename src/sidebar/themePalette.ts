import { isRecord } from "../shared/records";

export interface ThemeTokenPalette {
  readonly keyword?: string;
  readonly type?: string;
  readonly property?: string;
  readonly string?: string;
  readonly number?: string;
  readonly constant?: string;
  readonly enumMember?: string;
  readonly operator?: string;
  readonly comment?: string;
}

export interface ThemeData {
  readonly include?: string;
  readonly semanticTokenColors: Readonly<Record<string, unknown>>;
  readonly tokenColors: readonly TextMateRule[];
}

interface TextMateRule {
  readonly scope?: string | readonly string[];
  readonly settings?: { readonly foreground?: unknown };
}

interface PaletteMapping {
  readonly key: keyof ThemeTokenPalette;
  readonly semantic: readonly string[];
  readonly scopes: readonly string[];
}

const PALETTE_MAPPINGS: readonly PaletteMapping[] = [
  { key: "keyword", semantic: ["keyword"], scopes: ["keyword", "storage.type", "support.type.primitive"] },
  { key: "type", semantic: ["type", "class", "interface"], scopes: ["entity.name.type", "support.type"] },
  { key: "property", semantic: ["property"], scopes: ["variable.other.property"] },
  { key: "string", semantic: ["string"], scopes: ["string"] },
  { key: "number", semantic: ["number"], scopes: ["constant.numeric"] },
  { key: "constant", semantic: ["variable.readonly"], scopes: ["constant.language"] },
  { key: "enumMember", semantic: ["enumMember"], scopes: ["variable.other.enummember"] },
  { key: "operator", semantic: ["operator"], scopes: ["keyword.operator"] },
  { key: "comment", semantic: ["comment"], scopes: ["comment"] },
];

export function emptyThemeData(): ThemeData {
  return { semanticTokenColors: {}, tokenColors: [] };
}

/**
 * Parse JSONC theme data and retain only supported token rule shapes.
 * @param source Theme file text to parse as JSONC.
 */
export function parseThemeData(source: string): ThemeData | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonCommentsAndTrailingCommas(source));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const include = typeof parsed.include === "string" ? parsed.include : undefined;
  const semanticTokenColors = isRecord(parsed.semanticTokenColors) ? parsed.semanticTokenColors : {};
  const tokenColors = Array.isArray(parsed.tokenColors)
    ? parsed.tokenColors.filter(isTextMateRule)
    : [];
  return {
    ...(include === undefined ? {} : { include }),
    semanticTokenColors,
    tokenColors,
  };
}

/**
 * Apply local theme overrides after inherited semantic and TextMate token rules.
 * @param inherited Previously loaded base-theme rules.
 * @param local Current theme rules that override inherited rules.
 */
export function mergeThemeData(inherited: ThemeData, local: ThemeData): ThemeData {
  return {
    semanticTokenColors: {
      ...inherited.semanticTokenColors,
      ...local.semanticTokenColors,
    },
    tokenColors: [...inherited.tokenColors, ...local.tokenColors],
  };
}

/**
 * Choose semantic colors first and fall back to matching TextMate rules.
 * @param theme Validated semantic and TextMate rules.
 */
export function resolveThemeTokenPalette(theme: ThemeData): ThemeTokenPalette {
  const palette: Partial<Record<keyof ThemeTokenPalette, string>> = {};
  for (const mapping of PALETTE_MAPPINGS) {
    const semantic = semanticForeground(theme.semanticTokenColors, mapping.semantic);
    const textMate = textMateForeground(theme.tokenColors, mapping.scopes);
    const foreground = semantic ?? textMate;
    if (foreground !== undefined) {
      palette[mapping.key] = foreground;
    }
  }
  return palette;
}

/**
 * Accept only hexadecimal CSS colors to keep theme CSS insertion bounded.
 * @param value Untrusted value to validate or normalize.
 */
export function normalizeThemeColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(normalized)
    ? normalized
    : undefined;
}

/**
 * Choose the first supported semantic selector with a valid foreground.
 * @param colors Semantic token selector rules from the theme.
 * @param selectors Preferred semantic selector names in priority order.
 */
function semanticForeground(
  colors: Readonly<Record<string, unknown>>,
  selectors: readonly string[],
): string | undefined {
  for (const selector of selectors) {
    const rule = colors[selector];
    const foreground = normalizeThemeColor(
      typeof rule === "string" ? rule : isRecord(rule) ? rule.foreground : undefined,
    );
    if (foreground !== undefined) {
      return foreground;
    }
  }
  return undefined;
}

/**
 * Prefer exact scopes and later theme rules before broader scope matches.
 * @param rules TextMate rules in original theme order.
 * @param scopes Preferred TextMate scopes to match.
 */
function textMateForeground(rules: readonly TextMateRule[], scopes: readonly string[]): string | undefined {
  for (const exactOnly of [true, false]) {
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (rule === undefined || !scopeMatches(rule.scope, scopes, exactOnly)) {
        continue;
      }
      const foreground = normalizeThemeColor(rule.settings?.foreground);
      if (foreground !== undefined) {
        return foreground;
      }
    }
  }
  return undefined;
}

/**
 * Match comma-separated scope selectors against requested exact or descendant scopes.
 * @param ruleScope One or more selectors from the candidate TextMate rule.
 * @param wanted Scopes requested by the token category.
 * @param exactOnly Whether descendant scope matches are excluded.
 */
function scopeMatches(
  ruleScope: string | readonly string[] | undefined,
  wanted: readonly string[],
  exactOnly: boolean,
): boolean {
  if (ruleScope === undefined) {
    return false;
  }
  const selectors = (typeof ruleScope === "string" ? [ruleScope] : ruleScope)
    .flatMap((scope) => scope.split(","))
    .flatMap((scope) => scope.trim().split(/\s+/))
    .filter((scope) => scope.length > 0);
  return selectors.some((selector) => wanted.some((scope) =>
    exactOnly ? selector === scope : selector.startsWith(`${scope}.`)));
}

/**
 * Remove JSONC syntax while retaining quoted text and escaped characters.
 * @param source Theme file text to parse as JSONC.
 */
function stripJsonCommentsAndTrailingCommas(source: string): string {
  const withoutComments: string[] = [];
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n" || character === "\r") {
        lineComment = false;
        withoutComments.push(character);
      } else {
        withoutComments.push(" ");
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        withoutComments.push(" ", " ");
        index += 1;
        blockComment = false;
      } else {
        withoutComments.push(character === "\n" || character === "\r" ? character : " ");
      }
      continue;
    }
    if (inString) {
      withoutComments.push(character);
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutComments.push(character);
    } else if (character === "/" && next === "/") {
      lineComment = true;
      withoutComments.push(" ", " ");
      index += 1;
    } else if (character === "/" && next === "*") {
      blockComment = true;
      withoutComments.push(" ", " ");
      index += 1;
    } else {
      withoutComments.push(character);
    }
  }

  const result = withoutComments.join("").split("");
  inString = false;
  escaped = false;
  for (let index = 0; index < result.length; index += 1) {
    const character = result[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== ",") {
      continue;
    }
    let lookahead = index + 1;
    while (lookahead < result.length && /\s/.test(result[lookahead]!)) {
      lookahead += 1;
    }
    if (result[lookahead] === "}" || result[lookahead] === "]") {
      result[index] = " ";
    }
  }
  return result.join("");
}

/**
 * Validate supported scope and foreground fields of a TextMate theme rule.
 * @param value Untrusted value to validate or normalize.
 */
function isTextMateRule(value: unknown): value is TextMateRule {
  if (!isRecord(value)) {
    return false;
  }
  const scope = value.scope;
  const settings = value.settings;
  return (scope === undefined || typeof scope === "string" ||
      (Array.isArray(scope) && scope.every((entry) => typeof entry === "string"))) &&
    (settings === undefined || isRecord(settings));
}
