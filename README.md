# Full Type Viewer

A local VS Code Insiders extension for inspecting complete immediate TypeScript
7 alias shapes through the running native TypeScript server.

Enable `js/ts.experimental.useTsgo`, open **Full Type** in Explorer, and place
the cursor on a type alias declaration name. Use the title actions to refresh,
expand one level, collapse, or copy the current raw representation.

```sh
npm install
npm run check
npm run package
code-insiders --install-extension ts-full-type-viewer-0.0.1.vsix --force
```
