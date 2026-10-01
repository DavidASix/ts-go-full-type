import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { FullTypeViewerTestingAPI } from "../../src/extension";
import type { TypeRenderNode, ViewState } from "../../src/shared/protocol";

const EXTENSION_ID = "undefined_publisher.ts-full-type-viewer";

export async function run(): Promise<void> {
  const native = vscode.extensions.getExtension("TypeScriptTeam.native-preview");
  assert.ok(native, "TypeScriptTeam.native-preview must be installed");
  assert.equal(native.packageJSON.version, "1.0.1", "native-preview version is pinned to 1.0.1");
  await native.activate();
  assert.equal(native.isActive, true, "native extension activates");

  const extension = vscode.extensions.getExtension<FullTypeViewerTestingAPI>(EXTENSION_ID);
  assert.ok(extension, "Full Type Viewer development extension is present");
  const api = await extension.activate();

  const fixtureUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, "types.ts");
  const document = await vscode.workspace.openTextDocument(fixtureUri);
  const editor = await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("workbench.view.explorer");
  await vscode.commands.executeCommand("fullTypeViewer.type.focus");

  await focusAlias(editor, document, "LargeUnion");
  let state = await waitForSuccess(api, "LargeUnion");
  assert.match(state.rawText, /kind: "a"/);
  assert.match(state.rawText, /kind: "l"/);
  assert.ok(state.result.project.endsWith("fixtures/tsconfig.json"), "fixture configured project is selected");

  const lastMember = '| { kind: "l"; value: unknown };';
  const semicolon = document.getText().indexOf(lastMember) + lastMember.length - 1;
  assert.ok(semicolon >= lastMember.length - 1, "fixture contains the last LargeUnion member");
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, document.positionAt(semicolon), '\n  | { kind: "unsaved"; changed: true }');
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  const unsavedState = await waitUntil(api, (candidate) => candidate.kind === "success" && candidate.rawText.includes('kind: "unsaved"'));
  assert.equal(unsavedState.kind, "success");
  state = unsavedState;
  assert.match(state.rawText, /changed: true/);

  await focusAlias(editor, document, "NamedMemberHolder");
  state = await waitForSuccess(api, "NamedMemberHolder");
  const member = findNode(state.result.root, (node) => node.text === "NamedRecursiveMember" && node.viewNodeId.length > 0);
  assert.ok(member?.viewNodeId, `named member is expandable: ${JSON.stringify(state.result.root)}`);
  await api.toggle(member.viewNodeId);
  state = await waitForSuccess(api, "NamedMemberHolder");
  const child = findNode(state.result.root, (node) => node.text === "NamedMember");
  assert.ok(child, "expansion exposes immediate child property");
  assert.equal(child.state, "collapsed");
  await api.toggle(child.viewNodeId);
  state = await waitForSuccess(api, "NamedMemberHolder");
  assert.ok(hasState(state.result.root, "recursive"), "recursive edge terminates visibly");

  await focusAlias(editor, document, "NamedMemberHolder");
  await vscode.commands.executeCommand("fullTypeViewer.collapseAll");
  state = await waitForSuccess(api, "NamedMemberHolder");
  assert.equal(findNode(state.result.root, (node) => node.text === "NamedRecursiveMember" && node.viewNodeId.length > 0)?.state, "collapsed");

  await vscode.commands.executeCommand("fullTypeViewer.expandLevel");
  state = await waitForSuccess(api, "NamedMemberHolder");
  const expandedMember = findNode(state.result.root, (node) => node.text === "NamedRecursiveMember" && node.viewNodeId.length > 0);
  assert.equal(expandedMember?.state, "expanded");
  assert.equal(findNode(expandedMember!, (node) => node.text === "NamedMember")?.state, "collapsed", "one command advances one breadth step");

  await vscode.commands.executeCommand("fullTypeViewer.collapseAll");
  state = await waitForSuccess(api, "NamedMemberHolder");
  assert.equal(findNode(state.result.root, (node) => node.text === "NamedRecursiveMember" && node.viewNodeId.length > 0)?.state, "collapsed");

  await focusAlias(editor, document, "LargeUnion");
  await focusAlias(editor, document, "RecursiveNode");
  state = await waitForSuccess(api, "RecursiveNode");
  assert.equal(state.result.name, "RecursiveNode", "latest focus wins over an older in-flight request");

  await vscode.commands.executeCommand("workbench.action.files.revert");

  const targetUri = vscode.Uri.file("/home/davidasix/BigRiverAnalytics/rigc-base/src/server/datasets/virtual/types.ts");
  const targetDocument = await vscode.workspace.openTextDocument(targetUri);
  const targetEditor = await vscode.window.showTextDocument(targetDocument);
  await focusAlias(targetEditor, targetDocument, "VirtualDatasetCell");
  state = await waitForSuccess(api, "VirtualDatasetCell");
  assert.ok(state.result.project.endsWith("rigc-base/tsconfig.json"), "real configured project is selected");
  const initialRaw = state.rawText;
  for (const discriminant of [
    "STRING",
    "NUMBER",
    "BOOLEAN",
    "DATE",
    "DATABASE_ID",
    "GENERIC_ID",
    "MATRIX_QUESTION",
    "ARRAY",
  ]) {
    assert.ok(initialRaw.includes(`VirtualDatasetCellDataType.${discriminant}`), `shows ${discriminant}`);
  }
  for (const property of [
    "application_entity_type",
    "application_database_reference",
    "referenced_dataset_row",
    "group_key",
    "question_text",
    "response_values",
    "element",
    "value",
  ]) {
    assert.ok(initialRaw.includes(property), `shows immediate property ${property}`);
  }
  assert.doesNotMatch(initialRaw, /\.\.\.\s+\d+\s+more\s+\.\.\.|\{\s*\.\.\.\s*\}/);

  const element = findEdgeNode(
    state.result.root,
    "element",
    (node) => node.state === "collapsed" && node.text.includes("VirtualDatasetArrayElementType"),
  );
  assert.ok(element?.viewNodeId, `array element alias is expandable: ${JSON.stringify(collectEdges(state.result.root, "element"))}`);
  await api.toggle(element.viewNodeId);
  state = await waitForSuccess(api, "VirtualDatasetCell");
  assert.ok(hasState(element, "recursive"), "nested array terminates at a recursive edge");
  await vscode.commands.executeCommand("fullTypeViewer.collapseAll");
  state = await waitForSuccess(api, "VirtualDatasetCell");
  assert.equal(state.rawText, initialRaw, "collapse-all restores the initial complete shallow display");
  await assertCopyCommand(state.rawText);
}

async function focusAlias(
  editor: vscode.TextEditor,
  document: vscode.TextDocument,
  name: string,
): Promise<void> {
  const offset = document.getText().indexOf(`type ${name}`) + "type ".length;
  assert.ok(offset >= "type ".length, `fixture contains ${name}`);
  const position = document.positionAt(offset);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
}

async function waitForSuccess(
  api: FullTypeViewerTestingAPI,
  name: string,
): Promise<Extract<ViewState, { kind: "success" }>> {
  const state = await waitUntil(api, (candidate) => candidate.kind === "success" && candidate.result.name === name);
  assert.equal(state.kind, "success");
  return state;
}

async function waitUntil(
  api: FullTypeViewerTestingAPI,
  predicate: (state: ViewState) => boolean,
): Promise<ViewState> {
  const deadline = Date.now() + 60_000;
  let last = api.getViewState();
  while (Date.now() < deadline) {
    last = api.getViewState();
    if (predicate(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for view state. Last state: ${JSON.stringify(last)}`);
}

function findNode(node: TypeRenderNode, predicate: (node: TypeRenderNode) => boolean): TypeRenderNode | undefined {
  if (predicate(node)) {
    return node;
  }
  for (const edge of node.children ?? []) {
    const found = findNode(edge.node, predicate);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function hasState(node: TypeRenderNode, state: TypeRenderNode["state"]): boolean {
  return node.state === state || (node.children ?? []).some((edge) => hasState(edge.node, state));
}

function findEdgeNode(
  node: TypeRenderNode,
  label: string,
  predicate: (node: TypeRenderNode) => boolean,
): TypeRenderNode | undefined {
  for (const edge of node.children ?? []) {
    if (edge.label === label && predicate(edge.node)) {
      return edge.node;
    }
    const found = findEdgeNode(edge.node, label, predicate);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function collectEdges(node: TypeRenderNode, label: string): Array<{ text: string; state: string; viewNodeId: string }> {
  const result: Array<{ text: string; state: string; viewNodeId: string }> = [];
  for (const edge of node.children ?? []) {
    if (edge.label === label) {
      result.push({ text: edge.node.text, state: edge.node.state, viewNodeId: edge.node.viewNodeId });
    }
    result.push(...collectEdges(edge.node, label));
  }
  return result;
}

async function assertCopyCommand(expected: string): Promise<void> {
  const copied = await vscode.commands.executeCommand<string>("fullTypeViewer.copy");
  assert.equal(copied, expected, "copy command writes the current raw TypeScript representation");
}
