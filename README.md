# Full Type Viewer

A local VS Code Insiders extension for inspecting complete immediate TypeScript
7 symbol types through the running native TypeScript server.

Enable `js/ts.experimental.useTsgo`, select **Full Type Viewer** in the Activity
Bar, and place the cursor on or select any identifier—at its declaration or a use site.
The explorer shows the semantic type at that position; selecting a type
reference expands its definition too. Use the title actions to refresh, expand
one level, collapse, or copy the current raw representation. The word-wrap
title action toggles wrapping for the current workspace.

```sh
npm install
npm run check
npm run package
code-insiders --install-extension ts-full-type-viewer-0.0.3.vsix --force
```
