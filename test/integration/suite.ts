import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { FullTypeViewerTestingAPI } from "../../src/extension";
import type { TypeRenderNode, ViewState } from "../../src/shared/protocol";

const EXTENSION_ID = "undefined_publisher.ts-full-type-viewer";

/**
 * Exercise the activated extension against the pinned native compiler in VS Code.
 */
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

  await focusAlias(editor, document, "ModifierFixture");
  state = await waitForSuccess(api, "ModifierFixture");
  assert.match(state.rawText, /readonly value: string/);
  assert.match(state.rawText, /readonly nested\?:/);
  const readonlyNested = findEdgeNode(state.result.root, "nested", (node) => node.content.state === "collapsed");
  assert.ok(readonlyNested);
  await api.toggle(readonlyNested.viewNodeId);
  await vscode.commands.executeCommand("fullTypeViewer.expandLevel");
  state = await waitForSuccess(api, "ModifierFixture");
  assert.match(state.rawText, /readonly count: number/);
  await focusAlias(editor, document, "MappedReadonlyFixture");
  state = await waitForSuccess(api, "MappedReadonlyFixture");
  assert.ok(state.result.root.content.children?.find((edge) => edge.label === "value")?.readonly);
  await focusAlias(editor, document, "MappedMutableFixture");
  state = await waitForSuccess(api, "MappedMutableFixture");
  assert.equal(state.result.root.content.children?.find((edge) => edge.label === "value")?.readonly, false);

  await focusIdentifier(editor, document, "selectedVariable");
  state = await waitForSuccess(api, "selectedVariable");
  assert.match(state.rawText, /fromDefinition: string/);
  assert.match(state.rawText, /nested:/);

  await focusIdentifier(editor, document, "CallSiteType", "const selectedVariable: ");
  state = await waitForSuccess(api, "CallSiteType");
  assert.match(state.rawText, /fromDefinition: string/);
  assert.match(state.rawText, /count: number/);

  await focusAlias(editor, document, "TreeFixture");
  state = await waitForSuccess(api, "TreeFixture");
  const tree = state.result.root;
  /**
   * Charge relationship labels and annotations against the presentation budget.
   * @param node Syntax or presentation node being processed.
   * @param label Property or relationship label to display or locate.
   */
  const edge = (node: TypeRenderNode, label: string): TypeRenderNode => {
    const result = node.content.children?.find((child) => child.label === label)?.node;
    assert.ok(result, `contains ${label}: ${JSON.stringify(node)}`);
    return result;
  };
  const nested = edge(tree, "nested");
  await api.toggle(nested.viewNodeId);
  const nestedChild = edge(nested, "child");
  await api.toggle(nestedChild.viewNodeId);
  assert.equal(edge(nestedChild, "value").text, "string");
  assert.equal(edge(nestedChild, "value").content.state, "leaf");
  const alternatives = edge(tree, "alternatives");
  await api.toggle(alternatives.viewNodeId);
  assert.equal(alternatives.content.children?.length, 2);
  for (const member of alternatives.content.children ?? []) {
    assert.equal(String(member.node.content.state), "collapsed", "union expansion advances one level");
    await api.toggle(member.node.viewNodeId);
    assert.equal(member.node.content.children?.[0]?.node.content.state, "leaf");
  }
  const values = edge(tree, "values");
  await api.toggle(values.viewNodeId);
  assert.equal(values.content.children?.[0]?.node.text, "string");
  const pair = edge(tree, "pair");
  await api.toggle(pair.viewNodeId);
  assert.equal(pair.content.children?.length, 2);
  assert.equal(pair.content.children?.[0]?.node.text, "string");
  const lookup = edge(tree, "lookup");
  await api.toggle(lookup.viewNodeId);
  const indexedValue = edge(lookup, "[key: string]");
  await api.toggle(indexedValue.viewNodeId);
  assert.ok(edge(indexedValue, "enabled"), "index value exposes its properties");
  const handler = edge(tree, "handler");
  assert.equal(handler.typeKind, "function");
  await api.toggle(handler.viewNodeId);
  const call = edge(handler, "call");
  await api.toggle(call.viewNodeId);
  const input = edge(call, "input");
  await api.toggle(input.viewNodeId);
  assert.equal(edge(input, "id").text, "string");
  const returns = edge(call, "return");
  await api.toggle(returns.viewNodeId);
  assert.equal(edge(returns, "result").text, "number");
  const factory = edge(tree, "factory");
  assert.equal(factory.typeKind, "function");
  await api.toggle(factory.viewNodeId);
  const construct = edge(factory, "new");
  await api.toggle(construct.viewNodeId);
  assert.equal(edge(construct, "name").text, "string");

  const phantom = edge(tree, "phantom");
  await api.toggle(phantom.viewNodeId);
  const argument = edge(phantom, "type argument 1");
  await api.toggle(argument.viewNodeId);
  assert.equal(edge(argument, "value").text, "number");
  assert.equal(edge(argument, "value").content.state, "leaf");
  state = await waitForSuccess(api, "TreeFixture");
  assert.doesNotMatch(state.rawText, /type argument 1:/);

  await focusAlias(editor, document, "GenericTree");
  state = await waitForSuccess(api, "GenericTree");
  for (const label of ["value", "key", "indexed", "conditional", "template", "mapped"]) {
    const node = edge(state.result.root, label);
    assert.equal(String(node.content.state), "collapsed", `${label} is expandable`);
    await api.toggle(node.viewNodeId);
    state = await waitForSuccess(api, "GenericTree");
    assert.equal(state.notice, undefined, `${label} expands without an API error`);
    assert.equal(String(node.content.state), "expanded");
    assert.ok((node.content.children?.length ?? 0) > 0, `${label} has semantic children`);
  }

  await focusAlias(editor, document, "LargeUnion");
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
  assert.equal(child.content.state, "collapsed");
  await api.toggle(child.viewNodeId);
  state = await waitForSuccess(api, "NamedMemberHolder");
  assert.ok(hasState(state.result.root, "recursive"), "recursive edge terminates visibly");

  await focusAlias(editor, document, "NamedMemberHolder");
  await vscode.commands.executeCommand("fullTypeViewer.collapseAll");
  state = await waitForSuccess(api, "NamedMemberHolder");
  assert.equal(findNode(state.result.root, (node) => node.text === "NamedRecursiveMember" && node.viewNodeId.length > 0)?.content.state, "collapsed");

  await vscode.commands.executeCommand("fullTypeViewer.expandLevel");
  state = await waitForSuccess(api, "NamedMemberHolder");
  const expandedMember = findNode(state.result.root, (node) => node.text === "NamedRecursiveMember" && node.viewNodeId.length > 0);
  assert.equal(expandedMember?.content.state, "expanded");
  assert.equal(findNode(expandedMember!, (node) => node.text === "NamedMember")?.content.state, "collapsed", "one command advances one breadth step");

  await vscode.commands.executeCommand("fullTypeViewer.collapseAll");
  state = await waitForSuccess(api, "NamedMemberHolder");
  assert.equal(findNode(state.result.root, (node) => node.text === "NamedRecursiveMember" && node.viewNodeId.length > 0)?.content.state, "collapsed");

  await focusAlias(editor, document, "LargeUnion");
  await focusAlias(editor, document, "RecursiveNode");
  state = await waitForSuccess(api, "RecursiveNode");
  assert.equal(state.result.name, "RecursiveNode", "latest focus wins over an older in-flight request");

  await vscode.commands.executeCommand("workbench.action.files.revert");

  const acceptanceFile = process.env.FULL_TYPE_VIEWER_ACCEPTANCE_FILE;
  if (acceptanceFile) await runAcceptanceSuite(api, acceptanceFile);
}

/**
 * Verify complete shallow output and recursive expansion in the optional real project fixture.
 * @param api Activated extension interface used by the integration suite.
 * @param acceptanceFile Optional real project source file to exercise.
 */
async function runAcceptanceSuite(api: FullTypeViewerTestingAPI, acceptanceFile: string): Promise<void> {
  const targetUri = vscode.Uri.file(acceptanceFile);
  const targetDocument = await vscode.workspace.openTextDocument(targetUri);
  const targetEditor = await vscode.window.showTextDocument(targetDocument);
  await focusAlias(targetEditor, targetDocument, "VirtualDatasetCell");
  let state = await waitForSuccess(api, "VirtualDatasetCell");
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
    (node) => node.content.state === "collapsed" && node.text.includes("VirtualDatasetArrayElementType"),
  );
  assert.ok(element?.viewNodeId, `array element alias is expandable: ${JSON.stringify(collectEdges(state.result.root, "element"))}`);
  await api.toggle(element.viewNodeId);
  state = await waitForSuccess(api, "VirtualDatasetCell");
  // A union now reveals independently expandable members, rather than silently
  // materializing their properties during the same click.
  for (const member of element.content.children ?? []) {
    if (member.node.content.state === "collapsed") await api.toggle(member.node.viewNodeId);
  }
  const nestedElement = findEdgeNode(element, "element", (node) => node.content.state === "recursive" || node.content.state === "collapsed");
  if (nestedElement?.content.state === "collapsed") await api.toggle(nestedElement.viewNodeId);
  assert.ok(hasState(element, "recursive"), `nested array terminates at a recursive edge: ${JSON.stringify(element)}`);
  await vscode.commands.executeCommand("fullTypeViewer.collapseAll");
  state = await waitForSuccess(api, "VirtualDatasetCell");
  assert.equal(state.rawText, initialRaw, "collapse-all restores the initial complete shallow display");
  await assertCopyCommand(state.rawText);
}

/**
 * Move the editor cursor onto an alias declaration in the integration fixture.
 * @param editor Editor supplying the active document and selection.
 * @param document Editor document supplying source text and offsets.
 * @param name Identifier or relationship label being selected.
 */
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

/**
 * Select an identifier at a specific occurrence in the integration fixture.
 * @param editor Editor supplying the active document and selection.
 * @param document Editor document supplying source text and offsets.
 * @param name Identifier or relationship label being selected.
 * @param prefix Text identifying the intended identifier occurrence.
 */
async function focusIdentifier(
  editor: vscode.TextEditor,
  document: vscode.TextDocument,
  name: string,
  prefix = "",
): Promise<void> {
  const offset = document.getText().indexOf(`${prefix}${name}`) + prefix.length;
  assert.ok(offset >= prefix.length, `fixture contains ${prefix}${name}`);
  const position = document.positionAt(offset);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
}

/**
 * Wait for the requested symbol to become the published successful result.
 * @param api Activated extension interface used by the integration suite.
 * @param name Identifier or relationship label being selected.
 */
async function waitForSuccess(
  api: FullTypeViewerTestingAPI,
  name: string,
): Promise<Extract<ViewState, { kind: "success" }>> {
  const state = await waitUntil(api, (candidate) => candidate.kind === "success" && candidate.result.name === name);
  assert.equal(state.kind, "success");
  return state;
}

/**
 * Poll observable integration state with a bounded timeout and diagnostic output.
 * @param api Activated extension interface used by the integration suite.
 * @param predicate Condition selecting the expected observable state or node.
 */
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

/**
 * Search visible graph descendants for a matching integration assertion target.
 * @param node Syntax or presentation node being processed.
 * @param predicate Condition selecting the expected observable state or node.
 */
function findNode(node: TypeRenderNode, predicate: (node: TypeRenderNode) => boolean): TypeRenderNode | undefined {
  if (predicate(node)) {
    return node;
  }
  for (const edge of node.content.children ?? []) {
    const found = findNode(edge.node, predicate);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function hasState(node: TypeRenderNode, state: TypeRenderNode["content"]["state"]): boolean {
  return node.content.state === state || (node.content.children ?? []).some((edge) => hasState(edge.node, state));
}

/**
 * Search visible relationships for an edge whose child matches the predicate.
 * @param node Syntax or presentation node being processed.
 * @param label Property or relationship label to display or locate.
 * @param predicate Condition selecting the expected observable state or node.
 */
function findEdgeNode(
  node: TypeRenderNode,
  label: string,
  predicate: (node: TypeRenderNode) => boolean,
): TypeRenderNode | undefined {
  for (const edge of node.content.children ?? []) {
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

/**
 * Collect matching visible relationships for integration failure diagnostics.
 * @param node Syntax or presentation node being processed.
 * @param label Property or relationship label to display or locate.
 */
function collectEdges(node: TypeRenderNode, label: string): Array<{ text: string; state: string; viewNodeId: string }> {
  const result: Array<{ text: string; state: string; viewNodeId: string }> = [];
  for (const edge of node.content.children ?? []) {
    if (edge.label === label) {
      result.push({ text: edge.node.text, state: edge.node.content.state, viewNodeId: edge.node.viewNodeId });
    }
    result.push(...collectEdges(edge.node, label));
  }
  return result;
}

/**
 * Verify that the contributed Copy command returns the currently rendered representation.
 * @param expected Rendered text expected from the Copy command.
 */
async function assertCopyCommand(expected: string): Promise<void> {
  const copied = await vscode.commands.executeCommand<string>("fullTypeViewer.copy");
  assert.equal(copied, expected, "copy command writes the current raw TypeScript representation");
}
