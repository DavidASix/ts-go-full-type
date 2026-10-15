# Full Type Viewer behavioral specification

Status: current behavior for version `0.0.4`.

## Scope

Full Type Viewer presents the semantic type of a focused TypeScript identifier in a dedicated VS Code sidebar. It obtains that type from the active TypeScript 7 native server and displays a complete immediate shape with lazy, cycle-safe expansion below it.

The extension is local-only and deliberately tied to the versions and platform listed in the README. It does not start another compiler, parse hover Markdown, modify source files, or send project data over the network.

## Eligible focus

Resolution occurs only while the view is visible and all of these conditions hold:

- The active document is a file-backed `typescript` or `typescriptreact` document.
- There is exactly one cursor or selection.
- The cursor touches an identifier, or the selection remains within one identifier.

Whitespace, punctuation, literals, keywords, multi-symbol selections, unsupported documents, and hidden views do not trigger semantic work. An ineligible focus displays the idle state rather than retaining stale output.

Cursor and document changes are debounced by 250 ms. Reopening the view and manually refreshing resolve immediately. Movement within the same identifier and document version reuses the current result.

## Semantic resolution

Each request uses a snapshot from the running native server and verifies that its source text matches the active editor, including unsaved changes. The extension selects the default configured or inferred project for the file.

Resolution prefers associated type syntax, then the positional type, the AST location type, and finally the focused symbol. Import aliases are followed. Type symbols use their declared type; value symbols use their type at the focused location.

The native snapshot remains alive while its result is displayed because graph nodes retain snapshot-owned compiler handles. Replacing the result, hiding the view, reconnecting the server, or deactivating the extension disposes obsolete work and snapshots.

## Type graph

The initial tree exposes:

- every immediate union or intersection member;
- every immediate object property;
- tuple elements and array element types;
- generic type arguments;
- call and construct signatures, parameters, and return types;
- index-signature value types;
- constraints and operands for supported symbolic type operations.

Deeper named types remain collapsed. Expanding a node materializes exactly its immediate children from compiler APIs. **Expand One Level** expands the currently visible frontier once; newly created children remain collapsed. **Collapse All** restores the initial shallow graph.

Cycles are detected by native type identity along the current branch. Reusing a type in a sibling branch is not recursion. A recursive edge is visible but cannot expand further.

The graph never shortens a successful result. Compiler truncation markers, node-budget violations, or text-budget violations reject the interaction and preserve the previous valid tree.

## Definition navigation

Every visible node has an opaque view ID and may retain separate symbol and type definition targets:

- Right-clicking a row label requests the symbol definition.
- Right-clicking the displayed type or the rest of the row requests the type definition.
- If the preferred target is unavailable, the other retained target is used when available.
- A current node without a declaration reports that no definition exists.
- An unknown or obsolete node ID is rejected.

**Go to Definition** opens the first compiler declaration in a preview editor. **Cancel**, Escape, or clicking outside dismisses the context menu; Cancel and Escape restore focus to the originating row.

## Presentation and interaction

The sidebar has idle, loading, success, and error states. Successful results show source/project metadata and an accessible tree using the editor font and active theme colors.

Rows support mouse disclosure and roving keyboard focus. Long rows scroll horizontally unless workspace-level word wrapping is enabled. Updates for the same symbol reconcile nodes by ID so focus, selection, scrolling, and metadata disclosure survive unchanged branches.

Copy serializes the host-owned render tree as TypeScript. It excludes disclosure and recursion glyphs and never copies HTML.

## Protocol and security

The webview accepts only validated host render messages. It may send only:

```ts
type WebviewMessage =
  | { type: "ready" }
  | { type: "toggle"; viewNodeId: string }
  | {
      type: "goToDefinition";
      viewNodeId: string;
      target: "symbol" | "type";
    };
```

Compiler and workspace strings are escaped before entering HTML. The webview uses a nonce-protected local script and styles under `default-src 'none'`; it loads no remote resources and receives no native compiler IDs.

## Lifecycle and failures

Only the latest focus generation may publish. Native connection failures invalidate the current handles, wait for the next server initialization, and retry the latest active request once. Requests do not retry indefinitely.

Expected configuration, synchronization, unsupported-focus, missing-definition, and graph-limit outcomes are handled without crashing the extension. Unexpected failures produce a VS Code error notification; recoverable graph failures retain the last valid type with an in-view notice.

## Acceptance criteria

A release is acceptable when:

1. The packaged VSIX installs in the supported VS Code Insiders environment.
2. Declaration and use-site identifiers resolve through the active native server.
3. Unsaved editor changes appear, or synchronization fails visibly rather than showing stale text.
4. Immediate semantic members are complete and contain no compiler truncation markers.
5. Expansion advances one level, collapse restores the initial graph, and recursive types cannot loop.
6. Older focus or server requests cannot replace the current result.
7. Copy produces the visible TypeScript structure without UI text.
8. Symbol labels and displayed types navigate to their respective definitions.
9. The webview remains keyboard accessible, CSP-safe, escaped, and local-only.
10. Unit/DOM checks and the supported-environment integration suite pass.
