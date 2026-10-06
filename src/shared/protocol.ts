export type ViewNodeState = "leaf" | "collapsed" | "expanded" | "recursive";

export type NodeLayout = "atom" | "object" | "union" | "intersection" | "array" | "tuple" | "details";

export interface TypeRenderEdge {
  readonly label?: string;
  readonly optional?: boolean;
  readonly annotation?: string;
  readonly node: TypeRenderNode;
}

export interface TypeRenderNode {
  readonly viewNodeId: string;
  readonly text: string;
  readonly typeKind?: NodeLayout;
  state: ViewNodeState;
  layout: NodeLayout;
  children?: readonly TypeRenderEdge[];
  expressionText?: string;
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
