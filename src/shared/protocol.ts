export type ViewNodeState = "leaf" | "collapsed" | "expanded" | "recursive";

export type NodeLayout = "atom" | "object" | "union" | "intersection" | "array" | "tuple" | "details";

export interface TypeRenderEdge {
  readonly role?: "typeArgument" | "call" | "construct" | "index";
  readonly label?: string;
  readonly optional?: boolean;
  readonly readonly?: boolean;
  readonly annotation?: string;
  readonly node: TypeRenderNode;
}

/** Compiler syntax fragments reference semantic descendants by their edge indexes. */
export type TypeExpressionPart = string | { readonly path: readonly number[]; readonly fallback: string };

export type NodeContent =
  | { readonly state: "leaf" | "collapsed" | "recursive"; readonly layout: "atom"; readonly children?: never; readonly expressionText?: never; readonly expression?: never }
  | { readonly state: "expanded"; readonly layout: Exclude<NodeLayout, "atom">; readonly children: readonly TypeRenderEdge[]; readonly expressionText?: string; readonly expression?: readonly TypeExpressionPart[] | undefined; readonly readonly?: boolean };

/** Renderers consume the graph's presentation; only TypeGraph replaces its content. */
export interface TypeRenderNode {
  readonly viewNodeId: string;
  readonly text: string;
  readonly typeKind?: NodeLayout | "function";
  readonly content: NodeContent;
  readonly provenance?: string;
  readonly note?: string;
}

export interface CompleteTypeResult {
  readonly name: string;
  readonly root: TypeRenderNode;
  readonly compilerVersion: "7.0.2";
  readonly sourceUri: string;
  readonly project: string;
  readonly generation: number;
}

export type ViewState =
  | { readonly kind: "idle"; readonly message: string }
  | { readonly kind: "loading"; readonly message: string }
  | { readonly kind: "success"; readonly result: CompleteTypeResult; readonly rawText: string; readonly notice?: string }
  | { readonly kind: "error"; readonly message: string };

export type WebviewMessage =
  | { readonly type: "toggle"; readonly viewNodeId: string }
  | { readonly type: "ready" };

export interface WebviewUpdate {
  readonly type: "render";
  readonly generation: string;
  readonly html: string;
  readonly paletteCss: string;
}

/**
 * Validate host render messages before the webview applies their content.
 * @param value Untrusted value to validate or normalize.
 */
export function parseWebviewUpdate(value: unknown): WebviewUpdate | undefined {
  if (!isRecord(value) || value.type !== "render" || typeof value.generation !== "string" ||
    typeof value.html !== "string" || typeof value.paletteCss !== "string") return undefined;
  return { type: "render", generation: value.generation, html: value.html, paletteCss: value.paletteCss };
}

/**
 * Accept only supported disclosure and readiness messages with exact payload shapes.
 * @param value Untrusted value to validate or normalize.
 */
export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }
  if (value.type === "ready") {
    return Object.keys(value).length === 1 ? { type: "ready" } : undefined;
  }
  if (
    value.type === "toggle" &&
    typeof value.viewNodeId === "string" &&
    value.viewNodeId.length > 0 &&
    Object.keys(value).length === 2
  ) {
    return { type: "toggle", viewNodeId: value.viewNodeId };
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
