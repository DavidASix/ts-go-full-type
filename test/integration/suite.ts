import assert from "node:assert/strict";
import * as vscode from "vscode";
import { ViewDriver, findRow, type TreeRow } from "./viewDriver";

const EXTENSION_ID = "undefined_publisher.ts-full-type-viewer";

/** Exercise contributed commands and real disclosure clicks against the pinned native compiler. */
export async function run(): Promise<void> {
  const native = vscode.extensions.getExtension("TypeScriptTeam.native-preview");
  assert.ok(native);
  assert.equal(native.packageJSON.version, "1.0.1");
  await native.activate();
  assert.equal(native.isActive, true);
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension);
  assert.equal(await extension.activate(), undefined, "activation exports no testing interface");
  const driver = await ViewDriver.connect(process.env.FULL_TYPE_VIEWER_DEBUG_PORT!);
  try {
    const fixtureUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, "types.ts");
    const document = await vscode.workspace.openTextDocument(fixtureUri);
    const editor = await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("fullTypeViewer.type.focus");

    await focusAlias(editor, document, "LargeUnion");
    let state = await driver.wait("LargeUnion");
    assert.match(state.rawText, /kind: "a"/);
    assert.match(state.rawText, /kind: "l"/);
    assert.ok(state.metadata.includes("fixtures/tsconfig.json"));

    await focusAlias(editor, document, "ModifierFixture");
    state = await driver.wait("ModifierFixture");
    assert.match(state.rawText, /readonly value: string/);
    assert.match(state.rawText, /readonly nested\?:/);
    state = await driver.toggle(edge(state.root, "readonly nested?").id, state.name);
    await vscode.commands.executeCommand("fullTypeViewer.expandLevel");
    state = await driver.wait("ModifierFixture");
    assert.match(state.rawText, /readonly count: number/);
    await focusAlias(editor, document, "MappedReadonlyFixture");
    state = await driver.wait("MappedReadonlyFixture");
    assert.ok(edge(state.root, "readonly value"));
    await focusAlias(editor, document, "MappedMutableFixture");
    state = await driver.wait("MappedMutableFixture");
    assert.ok(edge(state.root, "value"));

    await focusIdentifier(editor, document, "selectedVariable");
    state = await driver.wait("selectedVariable");
    assert.match(state.rawText, /fromDefinition: string/);
    assert.match(state.rawText, /nested:/);
    await focusIdentifier(editor, document, "CallSiteType", "const selectedVariable: ");
    state = await driver.wait("CallSiteType");
    assert.match(state.rawText, /fromDefinition: string/);
    assert.match(state.rawText, /count: number/);

    await focusAlias(editor, document, "TreeFixture");
    state = await driver.wait("TreeFixture");
    state = await driver.toggle(edge(state.root, "nested").id, state.name);
    state = await driver.toggle(edge(edge(state.root, "nested"), "child").id, state.name);
    assert.equal(edge(edge(edge(state.root, "nested"), "child"), "value").summary, "string");
    state = await driver.toggle(edge(state.root, "alternatives").id, state.name);
    const alternatives = edge(state.root, "alternatives");
    assert.equal(alternatives.children.length, 2);
    assert.ok(alternatives.children.every((row) => row.expanded === false));
    for (const member of alternatives.children) state = await driver.toggle(member.id, state.name);
    assert.ok(edge(state.root, "alternatives").children.every((row) => row.children[0]?.expanded === undefined));
    state = await driver.toggle(edge(state.root, "values").id, state.name);
    assert.equal(edge(edge(state.root, "values"), "element").summary, "string");
    state = await driver.toggle(edge(state.root, "pair").id, state.name);
    assert.deepEqual(edge(state.root, "pair").children.map((row) => row.label), ["name", "count?"]);
    assert.equal(edge(edge(state.root, "pair"), "name").summary, "string");
    state = await driver.toggle(edge(state.root, "lookup").id, state.name);
    const indexedCopyBefore = state.rawText;
    state = await driver.toggle(edge(edge(state.root, "lookup"), "[key: string]").id, state.name);
    assert.notEqual(state.rawText, indexedCopyBefore, "Copy reflects expansion of the indexed value");
    assert.ok(edge(edge(edge(state.root, "lookup"), "[key: string]"), "enabled"));
    assert.match(state.rawText, /enabled:/);

    assert.equal(edge(state.root, "handler").iconClass, "function");
    state = await driver.toggle(edge(state.root, "handler").id, state.name);
    state = await driver.toggle(edge(edge(state.root, "handler"), "call").id, state.name);
    const parameterCopyBefore = state.rawText;
    state = await driver.toggle(edge(edge(edge(state.root, "handler"), "call"), "input").id, state.name);
    assert.notEqual(state.rawText, parameterCopyBefore, "Copy reflects expansion of the signature parameter");
    assert.equal(edge(edge(edge(edge(state.root, "handler"), "call"), "input"), "id").summary, "string");
    state = await driver.toggle(edge(edge(edge(state.root, "handler"), "call"), "return").id, state.name);
    assert.equal(edge(edge(edge(edge(state.root, "handler"), "call"), "return"), "result").summary, "number");
    assert.match(state.rawText, /result: number/);
    assert.equal(edge(state.root, "factory").iconClass, "function");
    state = await driver.toggle(edge(state.root, "factory").id, state.name);
    state = await driver.toggle(edge(edge(state.root, "factory"), "new").id, state.name);
    assert.equal(edge(edge(edge(state.root, "factory"), "new"), "name").summary, "string");
    state = await driver.toggle(edge(state.root, "phantom").id, state.name);
    state = await driver.toggle(edge(edge(state.root, "phantom"), "type argument 1").id, state.name);
    assert.equal(edge(edge(edge(state.root, "phantom"), "type argument 1"), "value").summary, "number");
    assert.doesNotMatch(state.rawText, /type argument 1:/);

    await focusAlias(editor, document, "GenericTree");
    state = await driver.wait("GenericTree");
    for (const label of ["value", "key", "indexed", "conditional", "template", "mapped"]) {
      assert.equal(edge(state.root, label).expanded, false);
      state = await driver.toggle(edge(state.root, label).id, state.name);
      assert.equal(state.notice, undefined);
      assert.ok(edge(state.root, label).children.length > 0);
    }

    await focusAlias(editor, document, "LargeUnion");
    const lastMember = '| { kind: "l"; value: unknown };';
    const semicolon = document.getText().indexOf(lastMember) + lastMember.length - 1;
    assert.ok(semicolon >= lastMember.length - 1);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, document.positionAt(semicolon), '\n  | { kind: "unsaved"; changed: true }');
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    state = await driver.wait("LargeUnion", (view) => view.rawText.includes('kind: "unsaved"'));
    assert.match(state.rawText, /changed: true/);

    await focusAlias(editor, document, "NamedMemberHolder");
    state = await driver.wait("NamedMemberHolder");
    const member = edge(state.root, "member");
    assert.equal(member.expanded, false);
    state = await driver.toggle(member.id, state.name);
    assert.equal(edge(edge(state.root, "member"), "child").expanded, false);
    state = await driver.toggle(edge(edge(state.root, "member"), "child").id, state.name);
    // This union exposes independent member disclosures before recursive properties.
    for (const child of edge(edge(state.root, "member"), "child").children) {
      if (child.expanded === false) state = await driver.toggle(child.id, state.name);
    }
    assert.ok(findRow(state.root, (row) => row.recursive));
    await vscode.commands.executeCommand("fullTypeViewer.collapseAll");
    state = await driver.wait("NamedMemberHolder", (view) => edge(view.root, "member").expanded === false);
    await vscode.commands.executeCommand("fullTypeViewer.expandLevel");
    state = await driver.wait("NamedMemberHolder", (view) => edge(view.root, "member").expanded === true);
    assert.equal(edge(edge(state.root, "member"), "child").expanded, false);
    await vscode.commands.executeCommand("fullTypeViewer.collapseAll");
    await driver.wait("NamedMemberHolder", (view) => edge(view.root, "member").expanded === false);
    await focusAlias(editor, document, "LargeUnion");
    await focusAlias(editor, document, "RecursiveNode");
    state = await driver.wait("RecursiveNode");
    assert.equal(state.name, "RecursiveNode");
    await vscode.commands.executeCommand("workbench.action.files.revert");
    const acceptanceFile = process.env.FULL_TYPE_VIEWER_ACCEPTANCE_FILE;
    if (acceptanceFile) await runAcceptanceSuite(driver, acceptanceFile);
  } finally { driver.close(); }
}

/** Select a visible direct child by its user-facing relationship label. */
function edge(node: TreeRow, label: string): TreeRow {
  const child = node.children.find((row) => row.label === label);
  assert.ok(child, `Missing visible ${label}: ${JSON.stringify(node)}`);
  return child;
}

/** Verify complete output, individual disclosure clicks, and collapse in an optional real project. */
async function runAcceptanceSuite(driver: ViewDriver, acceptanceFile: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(acceptanceFile));
  const editor = await vscode.window.showTextDocument(document);
  await focusAlias(editor, document, "VirtualDatasetCell");
  let state = await driver.wait("VirtualDatasetCell");
  assert.ok(state.metadata.includes("rigc-base/tsconfig.json"));
  const initialRaw = state.rawText;
  for (const discriminant of ["STRING", "NUMBER", "BOOLEAN", "DATE", "DATABASE_ID", "GENERIC_ID", "MATRIX_QUESTION", "ARRAY"]) {
    assert.ok(initialRaw.includes(`VirtualDatasetCellDataType.${discriminant}`));
  }
  for (const property of ["application_entity_type", "application_database_reference", "referenced_dataset_row", "group_key", "question_text", "response_values", "element", "value"]) {
    assert.ok(initialRaw.includes(property));
  }
  assert.doesNotMatch(initialRaw, /\.\.\.\s+\d+\s+more\s+\.\.\.|\{\s*\.\.\.\s*\}/);
  const element = findRow(state.root, (row) => row.label === "element" && row.expanded === false && row.summary.includes("VirtualDatasetArrayElementType"));
  assert.ok(element);
  state = await driver.toggle(element.id, state.name);
  for (const member of findRow(state.root, (row) => row.id === element.id)!.children) {
    if (member.expanded === false) state = await driver.toggle(member.id, state.name);
  }
  const expandedElement = findRow(state.root, (row) => row.id === element.id)!;
  const nested = findRow(expandedElement, (row) => row.id !== element.id && row.label === "element" && (row.recursive || row.expanded === false));
  if (nested?.expanded === false) state = await driver.toggle(nested.id, state.name);
  assert.ok(findRow(findRow(state.root, (row) => row.id === element.id)!, (row) => row.recursive));
  await vscode.commands.executeCommand("fullTypeViewer.collapseAll");
  state = await driver.wait("VirtualDatasetCell", (view) => view.rawText === initialRaw);
  assert.equal(await vscode.commands.executeCommand<string>("fullTypeViewer.copy"), state.rawText);
}

/** Select an alias declaration through the real editor selection API. */
async function focusAlias(editor: vscode.TextEditor, document: vscode.TextDocument, name: string): Promise<void> {
  await focusIdentifier(editor, document, name, "type ");
}

/** Select the intended identifier occurrence without invoking internal focus handlers. */
async function focusIdentifier(editor: vscode.TextEditor, document: vscode.TextDocument, name: string, prefix = ""): Promise<void> {
  const match = document.getText().indexOf(`${prefix}${name}`);
  assert.ok(match >= 0);
  const position = document.positionAt(match + prefix.length);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
}
