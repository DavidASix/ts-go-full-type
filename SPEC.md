# Full Type Viewer for VS Code and TypeScript 7

## Objective

Build a small, local-only VS Code Insiders extension in TypeScript. When the
cursor is on, or a text selection stays within, a TypeScript identifier, the
extension shows the symbol's resolved, untruncated type in a view in the VS
Code sidebar. Identifiers may be selected at declarations or use sites,
including type references.

The first and primary target is:

```ts
export type VirtualDatasetCell = z.infer<typeof virtualDatasetCellSchema>;
```

The view must show every immediate union member and every immediate property of
those members. It must not contain presentation abbreviations such as:

```text
... 5 more ...
... N more ...
{ ... }
```

Deeper named types remain collapsed by default. The user can expand an
individual named type, or all currently visible named types, exactly one level
at a time. Expansion must remain lazy and cycle-safe; selecting a type must
never recursively expand its entire reachable type graph.

This is a focused local tool. It is not a Marketplace product, a general type
explorer, or a replacement for TypeScript hover.

## Locked local environment

The MVP may target this environment exactly:

- Linux x64.
- VS Code Insiders.
- VS Code engine `^1.126.0`.
- `TypeScriptTeam.native-preview` extension version `1.0.1`.
- The extension's bundled native compiler, TypeScript `7.0.2`.
- Native compiler commit `2bd066d87f5bafd315be9f40889d0a60b9e58e0b`.
- npm and TypeScript for this extension project.
- A trusted workspace.

The extension may require TypeScript 7 to be enabled with:

```json
{
  "js/ts.experimental.useTsgo": true
}
```

The deprecated `typescript.experimental.useTsgo` spelling does not need special
support.

Cross-platform support, stable VS Code support, protocol compatibility with
other TypeScript versions, and graceful migration to future TypeScript APIs are
outside the MVP.

## Confirmed feasibility

The installed `TypeScriptTeam.native-preview` extension exports:

```ts
interface NativePreviewExtensionAPI {
  onLanguageServerInitialized: vscode.Event<void>;
  initializeAPIConnection(pipe?: string): Promise<string>;
  registerContentMappers(
    contributorId: string,
    contributions: readonly unknown[],
  ): vscode.Disposable;
}
```

`initializeAPIConnection()` asks the running TypeScript 7 language server to
create an API session and returns the Unix-domain-socket path.

The exact matching `typescript@7.0.2` package exports an asynchronous API client
from `typescript/unstable/async`. It supports:

```ts
API.fromLSPConnection({ pipe })
api.updateSnapshot({ openFiles, closeFiles })
snapshot.getDefaultProjectForFile(file)
project.program.getSourceFile(file)
project.checker.getTypeFromTypeNode(node)
project.checker.getTypeAtPosition(file, offset)
project.checker.getTypeAtLocation(node)
project.checker.getSymbolAtLocation(node)
project.checker.getAliasedSymbol(symbol)
project.checker.getDeclaredTypeOfSymbol(symbol)
project.checker.getTypeOfSymbolAtLocation(symbol, node)
type.getAliasSymbol()
type.getTypes()
project.checker.getPropertiesOfType(type)
project.checker.getTypeOfSymbol(symbol)
project.checker.getTypeArguments(typeReference)
project.checker.typeToString(type, enclosingDeclaration, flags)
```

The matching AST package, `typescript/unstable/ast`, supports token lookup,
identifier qualification, type-alias identification, and type-reference-node
identification.

The relevant printer flags exist in TypeScript 7.0.2:

```ts
NodeBuilderFlags.NoTruncation
NodeBuilderFlags.MultilineObjectLiterals
NodeBuilderFlags.InTypeAlias
NodeBuilderFlags.UseStructuralFallback
```

A read-only feasibility probe against the real `VirtualDatasetCell` declaration
using the bundled TypeScript 7.0.2 executable confirmed:

- the configured `rigc-base/tsconfig.json` project is selected;
- the alias target can be resolved through the native API;
- `typeToString` with `NoTruncation`, `MultilineObjectLiterals`, and
  `InTypeAlias` returns 2,359 characters;
- the result has no compiler truncation marker;
- all seven scalar discriminants are present;
- the recursive array member is preserved as the named reference
  `VirtualDatasetArrayCell<VirtualDatasetArrayElementType>`.

That last result is correct cycle-safe compiler behavior, but it does not expose
the array member's immediate property names. The renderer therefore needs the
one-level structured expansion described below. It must not enable
`UseStructuralFallback` indiscriminately: doing so recursively expands the
array value until the compiler's instantiation-depth boundary and ends in
`any`.

Interactive expansion is feasible with the same API. Every API `Type` has a
snapshot-scoped numeric identity. Union and intersection types expose their
constituents, named types expose alias symbols and type arguments, and the
checker exposes immediate properties and their types. The extension can
therefore keep the current snapshot alive and materialize one requested level
without reparsing printed text or asking the compiler for recursive structural
fallback.

These identities are valid only for their originating snapshot. Expansion
state and host-side type handles must be discarded whenever the focused symbol
is resolved against a newer snapshot.

## Dependencies and packaging

Use npm and strict TypeScript.

Runtime dependency:

```json
{
  "typescript": "7.0.2"
}
```

Pin `typescript` exactly because the unstable client protocol must match the
installed TypeScript 7 server. The dependency supplies the JavaScript client
and its types. The extension must connect to the already-running native server;
it must not launch the dependency's compiler executable.

Development dependencies should include compatible pinned versions of:

- `@types/vscode` for VS Code `1.126`;
- `@types/node`;
- `esbuild`;
- a test runner;
- `@vscode/vsce` for producing a local VSIX.

Bundle the extension with esbuild. Externalize only the `vscode` module. The
bundle must contain the `typescript/unstable/async` and
`typescript/unstable/ast` JavaScript needed at runtime.

The local installation path is:

```text
npm install
  -> npm run check
  -> npm run package
  -> code-insiders --install-extension <generated.vsix> --force
```

No Marketplace publishing metadata, telemetry, update service, remote assets,
or network access is required.

## Sidebar user experience

Contribute a webview view named **Full Type** in a **Full Type Viewer** Activity
Bar container.

Suggested view identifier:

```text
fullTypeViewer.type
```

The view has these states:

1. **Idle:** `Place the cursor on a TypeScript symbol.`
2. **Loading:** `Resolving <SymbolName>...`
3. **Success:** source metadata followed by the complete rendered type.
4. **Error:** a concise actionable message.

Success should resemble:

```ts
// TypeScript 7.0.2
// src/server/datasets/virtual/types.ts

type VirtualDatasetCell =
  | {
      display_name: string;
      data_type: VirtualDatasetCellDataType.STRING;
      value?: string | undefined;
    }
  | {
      // remaining complete members
    };
```

Presentation requirements:

- monospace editor font;
- selectable text;
- preserved indentation and line breaks;
- vertical and horizontal scrolling;
- HTML-escaped content;
- compact disclosure controls beside expandable named types;
- all controls must have accessible labels and keyboard activation;
- one local bundled webview script protected by a nonce-based Content Security
  Policy;
- no inline scripts, remote scripts, or remote resources;
- no source-file modification;
- no generated filesystem file.

Contribute these view-title commands:

- `fullTypeViewer.refresh` — rerun resolution at the current cursor or
  selection;
- `fullTypeViewer.expandLevel` — expand every currently visible expandable
  frontier node by one level;
- `fullTypeViewer.collapseAll` — restore the default shallow representation;
- `fullTypeViewer.copy` — copy the currently expanded raw representation to the
  clipboard, without disclosure-control text.
- `fullTypeViewer.enableWordWrap` / `fullTypeViewer.disableWordWrap` — toggle
  wrapping and persist the choice in workspace state.

Per-node behavior:

- A collapsed node is shown as `▸ TypeName`.
- Activating it reveals exactly its immediate children and changes it to
  `▾ TypeName`.
- Activating an expanded node collapses that node and all expansion state below
  it.
- A recursive edge is shown as `↩ TypeName` and cannot be expanded on that
  branch.
- A node with no meaningful structured children has no disclosure control.

The extension must not open an output editor automatically.

## What “focus a symbol” means

For the MVP, update the view only when all these conditions hold:

- there is an active editor;
- its language is `typescript` or `typescriptreact`;
- its URI scheme is `file`;
- there is one cursor or selection;
- the cursor touches a TypeScript identifier, or the selection stays within a
  single identifier.

Examples that qualify include declarations and use sites:

```ts
type Example = SomeType;
     // ^ cursor on any character of Example

const value: Example = getValue();
      // ^ value                  ^ getValue
             // ^ Example at its use site

// Selecting all or part of one identifier also qualifies.
```

These do not qualify:

- whitespace, punctuation, literals, or the `type` keyword;
- JavaScript files;
- untitled documents.

When focus does not qualify, show the idle state rather than retaining a stale
type from the previous cursor position.

## Update behavior

Observe:

- `window.onDidChangeActiveTextEditor`;
- `window.onDidChangeTextEditorSelection`;
- `workspace.onDidChangeTextDocument` for the active document;
- sidebar visibility changes.

Rules:

- Resolve only while the Full Type view is visible.
- Debounce cursor and document changes by 250 ms.
- Resolve immediately when the view becomes visible.
- Every resolution gets a monotonically increasing generation number.
- A result may update the view only if its generation is still current.
- A newer cursor move makes all older in-flight results stale.
- Do not make a semantic request when the cursor moves within the same symbol
  identifier and the document version has not changed.
- Refresh explicitly bypasses this cache.
- Expansion and collapse interactions do not debounce and do not request a new
  snapshot; they operate on the current result.
- Expansion state is scoped to the current focused symbol, document version,
  snapshot, and native connection.
- Reset expansion state after a document change, focus change, explicit
  refresh, or native-server reconnect.

The TypeScript API client does not expose request cancellation. Cancellation in
the MVP therefore means ignoring stale results, not aborting a JSON-RPC request.

## Exact native integration

### Activation and connection

1. Get `TypeScriptTeam.native-preview` with
   `vscode.extensions.getExtension`.
2. Fail with an actionable view message if it is absent.
3. Activate it and validate the returned value as
   `NativePreviewExtensionAPI`; treat the boundary as `unknown` until checked.
4. Subscribe to `onLanguageServerInitialized`. The installed implementation
   invokes a new subscriber immediately if the server is already initialized.
5. Wait up to 15 seconds for initialization.
6. Call `initializeAPIConnection()` to obtain a pipe path.
7. Connect with:

```ts
import { API } from "typescript/unstable/async";

const api = await API.fromLSPConnection({ pipe });
```

8. Keep one connection for the extension lifetime.
9. Call `api.close()` during extension deactivation.

If the native language server restarts, the pipe becomes invalid. On the first
socket/connection failure:

- dispose the old API client;
- wait for the next `onLanguageServerInitialized` event;
- create a new pipe and API client;
- retry the latest still-current focus once.

Do not retry indefinitely.

### Snapshot and project selection

Track the file opened for this API client. When the active file changes, make a
new snapshot with the new file opened and the old file closed:

```ts
const snapshot = await api.updateSnapshot({
  openFiles: [{ uri: activeDocument.uri.toString() }],
  closeFiles: previousUri ? [{ uri: previousUri }] : undefined,
});
```

For repeated requests in the same file, call `updateSnapshot()` without
reopening the file. This obtains the latest shared LSP snapshot, including the
editor overlay.

Then resolve the project:

```ts
const project = await snapshot.getDefaultProjectForFile({
  uri: activeDocument.uri.toString(),
});
```

Keep the current result's `Snapshot` alive while its type is displayed so that
expansion interactions can continue using its Type, Symbol, Project, and
Checker handles. Dispose that snapshot only after a newer result replaces it,
the view becomes idle/hidden, the connection is reset, or the extension is
disposed. Never use a Type, Symbol, Node, Project, or Checker object after its
snapshot is disposed.

Maintain a host-side registry of opaque view-node IDs to snapshot-owned Type
handles. The webview receives only the opaque IDs. It must never receive or
manufacture native Type IDs, project IDs, or API request parameters.

Unsaved changes are required to work. Before rendering, verify that the source
file text represented by the returned AST matches the active document version
or content. If the shared API snapshot is stale, show:

```text
TypeScript 7 has not synchronized this edit yet. Save or retry.
```

Never silently show a type from stale on-disk text.

### Symbol identification

For an empty selection, convert `selection.active` to a UTF-16 offset with
`document.offsetAt`. For a non-empty selection, require its start and end to
stay inside one VS Code word range and use the selection start as the lookup
offset. Reject multi-cursor and multi-symbol selections.

Use the snapshot program and TypeScript 7 AST utilities:

```ts
import {
  getTokenAtPosition,
  isIdentifier,
} from "typescript/unstable/ast";

const sourceFile = await project.program.getSourceFile({ uri });
const token = getTokenAtPosition(sourceFile, offset);
```

After obtaining the AST, focus qualifies only when the token is an identifier
and the chosen offset is inside its exact source range:

```ts
isIdentifier(token) &&
offset >= token.getStart(sourceFile) &&
offset < token.getEnd()
```

Use the token text as the display name.

### Type resolution

For a type-alias declaration name, resolve the alias's right-hand side rather
than the alias symbol as a self-reference. For an identifier in a type
reference at a use site, walk its ancestors to the enclosing
`TypeReferenceNode` and resolve that node. Do not treat an unrelated declaration
nested inside broader type syntax, such as a property-signature name, as a type
reference. This exposes the referenced definition while preserving use-site
generic arguments:

```ts
const type = await project.checker.getTypeFromTypeNode(token.parent.type);
const useSiteType = await project.checker.getTypeFromTypeNode(enclosingTypeNode);
```

For every other identifier—including variables, properties, function names,
and interface/class declaration names—resolve the semantic type at the token
position:

```ts
const type = await project.checker.getTypeAtPosition({ uri }, token.getStart(sourceFile));
```

If the position API returns no type or an error type, use
`checker.getTypeAtLocation(token)` from the same snapshot. If that also returns
no usable type, call `checker.getSymbolAtLocation(token)`. Follow aliases with
`checker.getAliasedSymbol`, then use `checker.getDeclaredTypeOfSymbol` for type
symbols or `checker.getTypeOfSymbolAtLocation` for value symbols.

If neither lookup returns a type, return to the idle state; if the resolved type
is an error type, show an error state. Do not fall back to hover or to a
separately spawned compiler.

### Primary compiler rendering

Use:

```ts
const flags =
  NodeBuilderFlags.NoTruncation |
  NodeBuilderFlags.MultilineObjectLiterals |
  NodeBuilderFlags.InTypeAlias;

const text = await project.checker.typeToString(
  type,
  token.parent,
  flags,
);
```

Do not parse hover Markdown. Do not use VS Code's hover provider. Do not run a
second TypeScript project service.

## Definition of complete and expansion boundary

For this MVP, complete means:

- expand the selected symbol's semantic type;
- expose every member of its immediate union or intersection;
- expose every immediate property of each object member;
- retain named references below that property boundary;
- retain named references at recursive cycle boundaries;
- never omit members because of length or member count;
- never return a shortened result labelled complete.

The extension does not transitively inline all aliases. In particular, this is
acceptable and desirable:

```ts
element: VirtualDatasetArrayElementType;
```

### One-level expansion of named top-level members

The compiler may intentionally preserve an immediate union member as a named
reference, as it does for:

```ts
VirtualDatasetArrayCell<VirtualDatasetArrayElementType>
```

When the root type is a union or intersection, render it member-by-member using
`type.getTypes()`.

For each member:

1. Ask `typeToString` for the member using the primary flags.
2. If the result is already an object/intersection shape, use it unchanged.
3. If the result is a named reference and the member is an object type, call
   `checker.getPropertiesOfType(member)`.
4. Render a synthetic one-level object block listing every returned property.
5. Preserve the named member in a comment for provenance.
6. Express each property type as an indexed access into that named member:

```ts
// VirtualDatasetArrayCell<VirtualDatasetArrayElementType>
{
  display_name: VirtualDatasetArrayCell<VirtualDatasetArrayElementType>["display_name"];
  data_type: VirtualDatasetArrayCell<VirtualDatasetArrayElementType>["data_type"];
  element: VirtualDatasetArrayCell<VirtualDatasetArrayElementType>["element"];
  value?: VirtualDatasetArrayCell<VirtualDatasetArrayElementType>["value"];
}
```

Use `SymbolFlags.Optional` to render `?`. Quote property names that are not legal
identifiers. This technique exposes the complete immediate shape while leaving
recursive or deeply computed property types compiler-owned and cycle-safe.

Do not globally apply `UseStructuralFallback`, and do not reconstruct property
types from source text.

If a named top-level member has call signatures, construct signatures, or index
signatures that cannot be represented by the property-only expansion, keep the
named member and add a visible note that the MVP cannot expand that member. Do
not label that result complete.

### Interactive one-level expansion

The default display remains the complete immediate shape defined above. Any
named type reference below that boundary may be offered as an expandable node.
Expansion is a view over the existing semantic type graph, not a new compiler
print mode.

For example, the default array member may include:

```ts
element: ▸ VirtualDatasetArrayElementType;
```

Expanding it once reveals that alias's immediate union members. Its recursive
array member still contains a collapsed `VirtualDatasetArrayElementType` edge;
that edge is marked recursive and is not followed again on the same branch.

Expansion targets include:

- named alias types;
- named object or interface types reached from a property;
- union and intersection types;
- instantiated generic type references;
- array and tuple element types when they contain a named expandable type.

For one expansion request:

1. Resolve the opaque view-node ID in the current host-side node registry.
2. Reject the message if the ID is unknown, belongs to an obsolete generation,
   or its snapshot has been disposed.
3. If the type ID already occurs in that node's ancestor chain, return a
   recursive-reference node instead of traversing it.
4. For unions and intersections, use `type.getTypes()` and create one child per
   constituent.
5. For object and instantiated reference types, use
   `checker.getPropertiesOfType(type)`, then
   `checker.getTypeOfSymbol(property)` for each property child.
6. For generic references, retain the compiler's instantiated display text and
   obtain type arguments with `checker.getTypeArguments(type)` when needed for
   child labels.
7. For arrays and tuples, expose their semantic element types rather than the
   methods inherited from `Array`.
8. Use `typeToString` with the primary no-truncation flags for each collapsed
   child label.
9. Update only the requested subtree and retain the rest of the expansion
   state.

Do not call `UseStructuralFallback` to implement interactive expansion. Do not
derive child relationships by parsing a printed type string.

The **Expand one level** command expands every expandable node on the currently
visible frontier. It performs only one breadth step per invocation. Nodes
created by that step stay collapsed until another invocation or an individual
click. **Collapse all** discards all user expansion state but retains the
default immediate root shape.

Expansion is limited by cycles, not by an arbitrary depth number. If a single
interaction would exceed a defensive node or output-size limit, reject that
interaction with a visible message and leave the prior view intact; never show
a partially expanded subtree as complete.

Expansion can only follow semantic types that remain present in the resolved
type graph. In this reproduction, `VirtualDatasetArrayCell` and
`VirtualDatasetArrayElementType` are expandable. A source value such as
`virtualDatasetArrayCellSchema` may be erased by `z.infer` and therefore may not
exist as a child of the resolved `VirtualDatasetCell` type. The user can focus
that source value directly to inspect its own semantic type, but the extension
must not invent an expansion link from a resolved type graph when the compiler
does not provide one.

### Truncation validation

Reject the result if it contains compiler presentation markers matching either:

```text
... <number> more ...
{ ... }
```

Do not reject ordinary rest syntax such as tuple rest elements or function rest
parameters.

Named type references and recursive references are not truncation.

## Rendering pipeline

The semantic layer returns metadata plus a snapshot-owned render tree. Each
node also carries the plain TypeScript text needed for display and copying:

```ts
interface CompleteTypeResult {
  name: string;
  root: TypeRenderNode;
  compilerVersion: "7.0.2";
  sourceUri: string;
  project: string;
  generation: number;
}

interface TypeRenderNode {
  viewNodeId: string;
  text: string;
  state: "leaf" | "collapsed" | "expanded" | "recursive";
  layout: "atom" | "object" | "union" | "intersection" | "array" | "tuple";
  children?: readonly TypeRenderEdge[];
  provenance?: string;
  note?: string;
}

interface TypeRenderEdge {
  label?: string;
  optional?: boolean;
  annotation?: string;
  node: TypeRenderNode;
}
```

Wrap the rendered expression as:

```ts
type <Name> =
  <expression>;
```

The renderer may normalize indentation and place top-level union bars on their
own lines. It must not tokenize and rewrite string literals, property names,
tuple labels, optional markers, intersections, or generic arguments.

The host, not the webview, owns the render tree and expansion state. The webview
may post only these validated messages:

```ts
type WebviewMessage =
  | { type: "toggle"; viewNodeId: string }
  | { type: "ready" };
```

Every rerender must regenerate escaped HTML from the host-owned state. The
webview script only forwards disclosure-control actions and restores focus; it
does not contain semantic data or construct TypeScript text.

Do not invoke VS Code's TypeScript formatter from the webview. Formatting
failure must never discard otherwise complete semantic output.

## Architecture

Use these responsibilities; exact filenames may vary slightly:

```text
src/
  extension.ts                 activation and disposal
  native/
    nativeExtension.ts         extension export validation and readiness
    nativeConnection.ts        pipe/API lifecycle and reconnect-once behavior
    completeTypeProvider.ts    snapshots, AST lookup, and type resolution
    focus.ts                   identifier and type-reference qualification
    typeGraph.ts               lazy child materialization and cycle detection
  sidebar/
    fullTypeViewProvider.ts    WebviewViewProvider and view states
    codeLayout.ts              shared semantic-to-code layout
    renderHtml.ts              CSP-safe escaped HTML
    renderText.ts              raw copy-text rendering
    webview.ts                 disclosure-control message forwarding only
  controller/
    focusController.ts         events, debounce, cache, stale-result guard
    expansionController.ts     node registry and expansion state
  shared/
    errors.ts
    protocol.ts
```

Keep VS Code event handling, TypeScript API access, semantic rendering, and HTML
rendering separately testable. Use strict TypeScript and validated `unknown` at
the native-extension export boundary. Do not use `any` in project code.

## Manifest requirements

The extension manifest must include the equivalent of:

```json
{
  "name": "ts-full-type-viewer",
  "displayName": "Full Type Viewer",
  "version": "0.0.1",
  "engines": {
    "vscode": "^1.126.0"
  },
  "extensionKind": ["workspace"],
  "activationEvents": ["onView:fullTypeViewer.type"],
  "extensionDependencies": ["TypeScriptTeam.native-preview"],
  "main": "./dist/extension.js",
  "capabilities": {
    "untrustedWorkspaces": {
      "supported": false
    }
  },
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "fullTypeViewer",
          "title": "Full Type Viewer",
          "icon": "resources/full-type-viewer.svg"
        }
      ]
    },
    "views": {
      "fullTypeViewer": [
        {
          "id": "fullTypeViewer.type",
          "name": "Full Type",
          "type": "webview"
        }
      ]
    },
    "commands": [
      {
        "command": "fullTypeViewer.refresh",
        "title": "Full Type Viewer: Refresh"
      },
      {
        "command": "fullTypeViewer.expandLevel",
        "title": "Full Type Viewer: Expand One Level"
      },
      {
        "command": "fullTypeViewer.collapseAll",
        "title": "Full Type Viewer: Collapse All"
      },
      {
        "command": "fullTypeViewer.copy",
        "title": "Full Type Viewer: Copy"
      },
      {
        "command": "fullTypeViewer.enableWordWrap",
        "title": "Full Type Viewer: Enable Word Wrap"
      },
      {
        "command": "fullTypeViewer.disableWordWrap",
        "title": "Full Type Viewer: Disable Word Wrap"
      }
    ]
  }
}
```

Add `view/title` menu entries for the word-wrap toggle, refresh, expand one
level, collapse all, and copy, scoped to `view == fullTypeViewer.type`. Gate
the two word-wrap commands with the persisted `fullTypeViewer.wordWrap`
context key.

## Error handling

Show concise in-view errors for:

- native-preview extension not installed;
- TypeScript 7 disabled;
- native server initialization timeout;
- API pipe connection failure;
- protocol/version mismatch;
- server restart during a request;
- file not owned by a configured or inferred project;
- stale editor overlay;
- an error semantic type after all resolution fallbacks;
- compiler output containing truncation markers;
- unsupported top-level callable/indexed member shape;
- obsolete or invalid expansion request;
- expansion exceeding a defensive resource limit.

Use notifications only for unexpected extension failures. Normal focus and
configuration states belong inside the sidebar. An ineligible focus or an
identifier with no semantic type is an idle state, not an error.

## Performance

- Warm focus-to-render target: under 500 ms after the 250 ms debounce.
- Initial server/project load may take longer and must show the loading state.
- Maintain one native API connection.
- Maintain at most one current displayed snapshot and dispose it promptly when
  its result is replaced or hidden.
- Do no semantic work while the view is hidden.
- Materialize expansion children lazily and cache them only for the lifetime of
  the current snapshot.
- A single-node expansion should normally render within 200 ms on a warm
  project.
- Do not impose a text-length truncation limit.
- If a defensive maximum is needed, fail explicitly instead of shortening.

## Tests

### Unit tests

Cover:

- native extension export validation;
- symbol-focus qualification at declarations and use sites;
- whole and partial single-identifier selections, plus rejection of selections
  spanning multiple symbols;
- type-reference-node qualification without misclassifying declaration names
  nested in broader type syntax;
- type resolution through alias/type syntax, semantic position, AST location,
  and declared/value-symbol fallbacks;
- UTF-16 cursor offsets;
- generation/stale-result suppression;
- debounce and same-symbol caching;
- snapshot replacement and disposal;
- root union/intersection member enumeration;
- named top-level member property expansion;
- optional and quoted property rendering;
- per-node expansion materializing exactly one level;
- expand-one-level breadth behavior;
- collapsing a node removes descendant expansion state;
- cycle detection by ancestor-chain type identity;
- sibling reuse not being mistaken for recursion;
- stale and unknown view-node IDs being rejected;
- expansion state resetting with a new snapshot;
- generic arguments and array/tuple element expansion;
- recursive named references not being treated as truncation;
- precise truncation-marker detection without rejecting rest syntax;
- HTML escaping;
- idle, loading, success, and error view states;
- nonce-based webview CSP and message validation;
- copy using the current expanded raw TypeScript text rather than HTML or
  disclosure glyphs.

### Repository fixture

Add a self-contained fixture with its own `tsconfig.json` containing:

```ts
type LargeUnion =
  | { kind: "a"; value: string }
  | { kind: "b"; value: number }
  // at least ten total members
  ;

type RecursiveNode = {
  value: string;
  children: RecursiveNode[];
};

type NamedMember =
  | { kind: "plain"; value: string }
  | NamedRecursiveMember;

type NamedRecursiveMember = {
  kind: "recursive";
  child: NamedMember;
};

type CallSiteType = {
  fromDefinition: string;
  nested: { count: number };
};

const selectedVariable: CallSiteType = {
  fromDefinition: "fixture",
  nested: { count: 1 },
};
```

The fixture must not depend on the external `rigc-base` repository.

### Local integration test

Run an Extension Host test against the installed
`TypeScriptTeam.native-preview@1.0.1` and TypeScript 7.0.2. It must prove:

- the native extension activates;
- an API pipe connection succeeds;
- the fixture project is selected;
- declarations and use-site identifiers are resolved from the shared LSP
  snapshot;
- selecting a variable shows its semantic type;
- selecting a type reference at a use site shows its definition;
- an unsaved edit changes the displayed type;
- the sidebar receives the current result;
- expanding `NamedRecursiveMember` exposes its immediate properties;
- expanding its `child` identifies a recursive edge without looping;
- expand-one-level advances only one breadth step;
- collapse-all restores the default shallow display;
- moving the cursor before a slow result completes cannot show stale text.

The same Extension Host suite also exercises the real `VirtualDatasetCell`
target as a local environment-specific acceptance test.

## Reproduction target

Repository:

```text
/home/davidasix/BigRiverAnalytics/rigc-base
```

File:

```text
src/server/datasets/virtual/types.ts
```

Locate this declaration by name rather than line number:

```ts
export type VirtualDatasetCell = z.infer<typeof virtualDatasetCellSchema>;
```

The displayed result must contain these eight discriminants:

```ts
VirtualDatasetCellDataType.STRING
VirtualDatasetCellDataType.NUMBER
VirtualDatasetCellDataType.BOOLEAN
VirtualDatasetCellDataType.DATE
VirtualDatasetCellDataType.DATABASE_ID
VirtualDatasetCellDataType.GENERIC_ID
VirtualDatasetCellDataType.MATRIX_QUESTION
VirtualDatasetCellDataType.ARRAY
```

It must expose these immediate properties:

- database ID: `application_entity_type`,
  `application_database_reference`, `referenced_dataset_row`;
- matrix question: `group_key`, `question_text`, `response_values`;
- array: `element`, `value`.

The recursive array property types may remain expressed through
`VirtualDatasetArrayCell`, `VirtualDatasetArrayElementType`, or indexed accesses
into those named types.

Manual expansion acceptance:

1. Expand the named array member or its `element` property.
2. The next level exposes the immediate shape of
   `VirtualDatasetArrayElementType`, including its scalar and nested-array
   alternatives.
3. The nested array's `element` reference is marked recursive rather than
   expanding forever.
4. Collapse it and confirm the initial shallow type is restored.

## Acceptance criteria

The MVP is complete only when all are true:

1. A locally packaged VSIX installs in VS Code Insiders.
2. Opening the Full Type Viewer view activates the extension.
3. Focusing any identifier, including the declared name `VirtualDatasetCell`,
   automatically updates the sidebar after the debounce.
4. The semantic result comes from the active TypeScript 7 native server through
   its API-session pipe.
5. No second compiler or project service is started.
6. The correct `rigc-base/tsconfig.json` project is used.
7. Unsaved editor changes are reflected, or the request fails visibly as stale.
8. All eight discriminants are visible.
9. Every immediate union member and its immediate properties are visible.
10. Database-ID, matrix-question, and array-specific fields are visible.
11. Recursive types terminate through named references or indexed accesses.
12. No compiler truncation marker appears.
13. Moving focus cannot allow an older result to overwrite the current view.
14. Copy places the complete raw TypeScript representation on the clipboard.
15. Source files are never modified.
16. A disclosure control can expand a named child type by exactly one level.
17. Expand-one-level expands only the current visible frontier.
18. Recursive edges terminate visibly and cannot loop.
19. Collapse-all restores the default complete immediate shape.
20. Expansion never triggers a new compiler process or parses printed type text.
21. Focusing a variable or other value symbol shows its semantic type.
22. Focusing a type reference at a use site shows its definition while
    preserving its use-site type arguments.
23. A whole or partial selection within one identifier resolves that symbol;
    a selection spanning multiple symbols returns the view to idle.

## Explicit exclusions

The MVP does not include:

- Marketplace publication;
- Windows or macOS support;
- VS Code Stable support;
- automatic dependency installation;
- telemetry or network calls;
- JavaScript files;
- a general-purpose AST or property explorer;
- go-to-definition links;
- hover integration;
- persistent generated files;
- classic tsserver plugins;
- a JavaScript TypeScript 5/6 fallback;
- a second tsgo process;
- a custom TypeScript fork;
- automatic transitive expansion of every named alias;
- expansion of source values erased from the resolved semantic type graph.

The project remains narrowly focused on showing the complete immediate semantic
type of a selected TypeScript symbol in the VS Code sidebar.
