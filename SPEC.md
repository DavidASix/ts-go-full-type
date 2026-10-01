# Full Type Viewer for VS Code and TypeScript 7

## Objective

Build a small, local-only VS Code Insiders extension in TypeScript. When the
cursor is on the declared name of a TypeScript type alias, the extension shows
that alias's resolved, untruncated type in a view in the VS Code sidebar.

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
project.checker.getPropertiesOfType(type)
project.checker.typeToString(type, enclosingDeclaration, flags)
```

The matching AST package, `typescript/unstable/ast`, supports token lookup and
type-alias identification.

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

Contribute a webview view named **Full Type** to the existing Explorer sidebar.
Do not create a separate Activity Bar container for the MVP.

Suggested view identifier:

```text
fullTypeViewer.type
```

The view has these states:

1. **Idle:** `Place the cursor on a type alias name.`
2. **Loading:** `Resolving <AliasName>...`
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
- no webview scripts or remote resources;
- no source-file modification;
- no generated filesystem file.

Contribute these view-title commands:

- `fullTypeViewer.refresh` — rerun resolution at the current cursor;
- `fullTypeViewer.copy` — copy the current raw rendered type to the clipboard.

The extension must not open an output editor automatically.

## What “focus a type” means

For the MVP, update the view only when all these conditions hold:

- there is an active editor;
- its language is `typescript` or `typescriptreact`;
- its URI scheme is `file`;
- the selection is empty;
- the cursor touches the identifier that is the declared name of a
  `TypeAliasDeclaration`.

Examples that qualify:

```ts
type Example = SomeType;
     // ^ cursor on any character of Example
```

These do not qualify in the MVP:

- whitespace or the `type` keyword;
- a use of an alias rather than its declaration;
- variables or expressions;
- interfaces, classes, or enum names;
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
- Do not make a semantic request when the cursor moves within the same alias
  identifier and the document version has not changed.
- Refresh explicitly bypasses this cache.

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

Dispose every prior `Snapshot` after a newer snapshot is available. Never use a
Type, Symbol, Node, Project, or Checker object after its snapshot is disposed.

Unsaved changes are required to work. Before rendering, verify that the source
file text represented by the returned AST matches the active document version
or content. If the shared API snapshot is stale, show:

```text
TypeScript 7 has not synchronized this edit yet. Save or retry.
```

Never silently show a type from stale on-disk text.

### Alias identification

Convert the VS Code cursor position to a UTF-16 offset with
`document.offsetAt(selection.active)`.

Use the snapshot program and TypeScript 7 AST utilities:

```ts
import {
  getTokenAtPosition,
  isIdentifier,
  isTypeAliasDeclaration,
} from "typescript/unstable/ast";

const sourceFile = await project.program.getSourceFile({ uri });
const token = getTokenAtPosition(sourceFile, offset);
```

The focus qualifies only when:

```ts
isIdentifier(token) &&
isTypeAliasDeclaration(token.parent) &&
token.parent.name === token
```

Use the token text as the display name.

### Type resolution

Resolve the alias's right-hand side, not the alias symbol as a self-reference:

```ts
const type = await project.checker.getTypeFromTypeNode(token.parent.type);
```

If this returns no type or an error type, show an error state. Do not fall back
to hover or to a separately spawned compiler.

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

- expand the selected alias;
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

The semantic layer returns plain TypeScript text and metadata:

```ts
interface CompleteTypeResult {
  name: string;
  text: string;
  compilerVersion: "7.0.2";
  sourceUri: string;
  project: string;
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
    expandImmediateType.ts     member/property boundary rendering
  sidebar/
    fullTypeViewProvider.ts    WebviewViewProvider and view states
    renderHtml.ts              CSP-safe escaped HTML
  controller/
    focusController.ts         events, debounce, cache, stale-result guard
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
    "views": {
      "explorer": [
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
        "command": "fullTypeViewer.copy",
        "title": "Full Type Viewer: Copy"
      }
    ]
  }
}
```

Add `view/title` menu entries for refresh and copy, scoped to
`view == fullTypeViewer.type`.

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
- cursor not on a type-alias declaration name;
- no semantic type or error type;
- compiler output containing truncation markers;
- unsupported top-level callable/indexed member shape.

Use notifications only for unexpected extension failures. Normal focus and
configuration states belong inside the sidebar.

## Performance

- Warm focus-to-render target: under 500 ms after the 250 ms debounce.
- Initial server/project load may take longer and must show the loading state.
- Maintain one native API connection.
- Maintain at most one current snapshot.
- Do no semantic work while the view is hidden.
- Do not impose a text-length truncation limit.
- If a defensive maximum is needed, fail explicitly instead of shortening.

## Tests

### Unit tests

Cover:

- native extension export validation;
- alias-focus qualification;
- UTF-16 cursor offsets;
- generation/stale-result suppression;
- debounce and same-alias caching;
- snapshot replacement and disposal;
- root union/intersection member enumeration;
- named top-level member property expansion;
- optional and quoted property rendering;
- recursive named references not being treated as truncation;
- precise truncation-marker detection without rejecting rest syntax;
- HTML escaping;
- idle, loading, success, and error view states;
- copy using the raw TypeScript text rather than HTML.

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
```

The fixture must not depend on the external `rigc-base` repository.

### Local integration test

Run an Extension Host test against the installed
`TypeScriptTeam.native-preview@1.0.1` and TypeScript 7.0.2. It must prove:

- the native extension activates;
- an API pipe connection succeeds;
- the fixture project is selected;
- a type alias is resolved from the shared LSP snapshot;
- an unsaved edit changes the displayed type;
- the sidebar receives the current result;
- moving the cursor before a slow result completes cannot show stale text.

The real `VirtualDatasetCell` remains a manual local acceptance test.

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

## Acceptance criteria

The MVP is complete only when all are true:

1. A locally packaged VSIX installs in VS Code Insiders.
2. Opening the Full Type Explorer view activates the extension.
3. Focusing the declared name `VirtualDatasetCell` automatically updates the
   sidebar after the debounce.
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

## Explicit exclusions

The MVP does not include:

- Marketplace publication;
- Windows or macOS support;
- VS Code Stable support;
- automatic dependency installation;
- telemetry or network calls;
- arbitrary variables and expressions;
- interfaces and classes;
- JavaScript files;
- alias-use-site resolution;
- a clickable property tree;
- go-to-definition links;
- hover integration;
- persistent generated files;
- classic tsserver plugins;
- a JavaScript TypeScript 5/6 fallback;
- a second tsgo process;
- a custom TypeScript fork;
- transitive expansion of every named alias.

The project remains narrowly focused on showing the complete immediate shape of
a declared TypeScript type alias in the VS Code sidebar.
