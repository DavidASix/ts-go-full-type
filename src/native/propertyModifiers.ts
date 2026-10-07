import { SymbolFlags, type Symbol as AsyncSymbol } from "typescript/unstable/async";
import { SyntaxKind, type Node } from "typescript/unstable/ast";

// The pinned 7.0.2 client exposes checkFlags but does not export CheckFlags.
// Values follow the native compiler: internal/ast/checkflags.go.
const READONLY = 1 << 3;
const SYNTHETIC_PROPERTY = 1 << 1;
const MAPPED_PROPERTY = 1 << 18;

export async function isReadonlyProperty(
  symbol: AsyncSymbol,
  query: <T>(operation: () => Promise<T>) => Promise<T>,
): Promise<boolean> {
  if (symbol.checkFlags & READONLY) return true;
  // For mapped/synthetic properties, the resolved flag is authoritative. Looking
  // through their declarations would undo a mapped type's `-readonly` modifier.
  if (symbol.checkFlags & (MAPPED_PROPERTY | SYNTHETIC_PROPERTY)) return false;
  if ((symbol.flags & SymbolFlags.GetAccessor) && !(symbol.flags & SymbolFlags.SetAccessor)) return true;
  for (const declaration of symbol.declarations ?? []) {
    const node = await query(() => declaration.resolve());
    if (node !== undefined && "modifiers" in node && Array.isArray(node.modifiers) &&
      (node.modifiers as readonly Node[]).some((modifier) => modifier.kind === SyntaxKind.ReadonlyKeyword)) return true;
  }
  return false;
}
