# Development

## Prerequisites

- Linux x64
- Node.js and npm
- VS Code Insiders on `PATH` as `code-insiders`
- `TypeScriptTeam.native-preview@1.0.1` installed in VS Code Insiders
- `js/ts.experimental.useTsgo` enabled

Install the pinned dependencies with:

```sh
npm ci
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Bundle the extension host and webview into `dist/`. |
| `npm run check` | Type-check and run unit plus DOM interaction tests. |
| `npm test` | Run the Vitest suite without a separate type-check. |
| `npm run test:coverage` | Run Vitest with the configured coverage thresholds. |
| `npm run test:integration` | Build and run the Extension Host suite. |
| `npm run package` | Build and create `ts-full-type-viewer-0.0.4.vsix`. |

## Architecture

```text
src/
  extension.ts                 activation, commands, and ownership
  controller/
    focusController.ts         editor events, debounce, and stale-result guards
    expansionController.ts     active graph session and view actions
  native/
    nativeExtension.ts         native-preview API validation
    nativeConnection.ts        connection lifecycle and reconnect-once behavior
    completeTypeProvider.ts    snapshots, project selection, and focused type resolution
    typeGraph.ts               lazy semantic graph and definition targets
  sidebar/
    fullTypeViewProvider.ts    host/webview transport and view state
    codeLayout.ts              shared TypeScript layout and token classification
    renderHtml.ts              escaped CSP-safe presentation
    renderText.ts              plain TypeScript copy output
    webview.ts                 tree interaction, context menu, and DOM state restoration
  shared/
    protocol.ts                validated host/webview message types
```

The extension host owns compiler handles, graph state, and rendered HTML. The webview receives opaque node IDs and presentation markup only. Snapshot-dependent operations are serialized so no compiler handle outlives its snapshot.

The native client is bundled and pinned to TypeScript `7.0.2`. Do not upgrade it independently of the native-preview server protocol.

## Tests

The regular check is self-contained:

```sh
npm run check
```

The integration suite launches the repository fixture in an isolated VS Code Insiders profile. By default it discovers `code-insiders` on `PATH` and native-preview `1.0.1` under `~/.vscode-insiders/extensions`.

Override either path when necessary:

```sh
FULL_TYPE_VIEWER_VSCODE=/path/to/code-insiders \
FULL_TYPE_VIEWER_NATIVE_EXTENSION=/path/to/typescriptteam.native-preview-1.0.1-linux-x64 \
npm run test:integration
```

An optional environment-specific acceptance file can also be exercised:

```sh
FULL_TYPE_VIEWER_ACCEPTANCE_FILE=/path/to/types.ts npm run test:integration
```

The suite removes its temporary profile and extension directory after the run.

## Package and install

Create and install a fresh package with:

```sh
npm run package
code-insiders --install-extension ./ts-full-type-viewer-0.0.4.vsix --force
```

Run **Developer: Reload Window** after installation. Packaging runs the build automatically; `npm run build` alone does not refresh the VSIX.

Before sharing a package:

1. Run `npm ci` from the committed lockfile.
2. Run `npm run check`.
3. Run `npm run test:integration` in the supported environment.
4. Run `npm run package`.
5. Install that VSIX with `--force`, reload VS Code, and smoke-test focus, expansion, Copy, and definition navigation.

When changing the version, update `package.json` and any versioned VSIX commands in `README.md` and this file together.

## Troubleshooting

- **The latest change is missing after reinstalling:** run `npm run package`, reinstall with `--force`, and reload the window. A build updates `dist/`, not the existing VSIX.
- **The view says TypeScript 7 is disabled:** enable `js/ts.experimental.useTsgo` and restart the TypeScript language server.
- **The native extension cannot be found:** install exactly `TypeScriptTeam.native-preview@1.0.1` in VS Code Insiders, not VS Code Stable.
- **The integration environment is not discovered:** set `FULL_TYPE_VIEWER_VSCODE` and `FULL_TYPE_VIEWER_NATIVE_EXTENSION` explicitly.
- **A type does not update after an edit:** wait for the native project to synchronize, then use the Refresh title action.
