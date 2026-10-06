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

The integration suite uses the locally installed VS Code Insiders and
`TypeScriptTeam.native-preview@1.0.1`, the repository fixtures, and the local
`rigc-base` acceptance project.
