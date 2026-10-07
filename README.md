# Full Type Viewer

A local VS Code Insiders extension for exploring TypeScript 7 semantic types
in an expandable sidebar tree through the running native TypeScript server.

Enable `js/ts.experimental.useTsgo`, select **Full Type Viewer** in the Activity
Bar, and place the cursor on or select any identifier at its declaration or a
use site. The tree follows the semantic type at that position.

Click a compound type or property row to reveal its next level. Follow nested
properties, union and intersection members, array elements, tuple positions,
generic arguments, function parameters and returns, constructors, and index
values down to primitive leaves. Recursive references show `↩` and terminate
that branch; unconstrained type parameters retain their symbolic type.

Use Up/Down to move between visible rows, Right to expand or enter a branch,
Left to collapse or return to its parent, and Enter/Space to toggle a row.
Home/End moves to the first/last visible row. Expansion preserves focus and
scroll position, and the tree follows the active VS Code theme.

The title actions refresh, expand every visible branch by one level, restore
the initial shallow tree, copy its TypeScript representation, or toggle word
wrapping for the current workspace. Hover a row to see its full compiler text.

```sh
npm install
npm run check
npm run test:integration
npm run package
code-insiders --install-extension ts-full-type-viewer-0.0.4.vsix --force
```

The integration suite runs against the repository fixtures. It discovers VS Code
Insiders on `PATH` and `TypeScriptTeam.native-preview@1.0.1` in the current user's
Insiders extensions directory. Temporary test profiles are removed after each run.
For a different installation, set `FULL_TYPE_VIEWER_VSCODE` to the executable and
`FULL_TYPE_VIEWER_NATIVE_EXTENSION` to the native extension directory.

The external `rigc-base` acceptance suite is optional:

```sh
FULL_TYPE_VIEWER_ACCEPTANCE_FILE=/path/to/rigc-base/src/server/datasets/virtual/types.ts npm run test:integration
```

The extension intentionally targets Linux x64, VS Code Insiders, and the pinned
TypeScript 7 native preview. Other compiler/protocol versions are unsupported.
