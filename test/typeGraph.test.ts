import { describe, expect, it, vi } from "vitest";
import {
  SignatureKind,
  SymbolFlags,
  type Checker,
  type Symbol as AsyncSymbol,
  type Type,
  type Signature,
  type IndexInfo,
} from "typescript/unstable/async";
import type { Node } from "typescript/unstable/ast";
import { TypeGraph, quotePropertyName } from "../src/native/typeGraph";
import { renderNode } from "../src/sidebar/renderText";

type Kind = "leaf" | "object" | "union" | "intersection" | "array" | "tuple";

interface FakeProperty {
  readonly symbol: AsyncSymbol;
  readonly type: Type;
}

interface FakeModel {
  readonly id: number;
  readonly text: string;
  readonly kind: Kind;
  readonly named: boolean;
  readonly aliasName: string;
  readonly properties: FakeProperty[];
  readonly members: Type[];
  readonly arguments: Type[];
  readonly aliasArguments: Type[];
  readonly calls: Signature[];
  readonly constructs: Signature[];
  readonly indexes: IndexInfo[];
  constraint?: Type;
}

function createHarness() {
  const models = new Map<number, FakeModel>();
  let nextId = 1;

  function type(
    text: string,
    kind: Kind = "leaf",
    options: { named?: boolean; aliasName?: string; nonPropertyShape?: boolean } = {},
  ): Type {
    const id = nextId++;
    const model: FakeModel = {
      id,
      text,
      kind,
      named: options.named ?? false,
      aliasName: options.aliasName ?? text,
      properties: [],
      members: [],
      arguments: [],
      aliasArguments: [],
      calls: [],
      constructs: [],
      indexes: [],
    };
    const fake = {
      id,
      flags: 0,
      getSymbol: async () => model.named ? ({ id: id * 100, name: text, flags: SymbolFlags.Interface } as AsyncSymbol) : undefined,
      getAliasSymbol: async () => model.named ? ({ id: id * 100 + 1, name: model.aliasName, flags: SymbolFlags.TypeAlias } as AsyncSymbol) : undefined,
      getAliasTypeArguments: async () => model.aliasArguments,
      getBaseTypes: async () => undefined,
      isClassOrInterface: () => false,
      isUnionType: () => model.kind === "union",
      isIntersectionType: () => model.kind === "intersection",
      isObjectType: () => ["object", "array", "tuple"].includes(model.kind),
      isIntrinsicType: () => false,
      isErrorType: () => false,
      isLiteralType: () => false,
      isStringLiteralType: () => false,
      isNumberLiteralType: () => false,
      isBigIntLiteralType: () => false,
      isBooleanLiteralType: () => false,
      isTypeReference: () => model.kind === "array" || model.kind === "tuple",
      isTupleType: () => model.kind === "tuple",
      isIndexType: () => false,
      isIndexedAccessType: () => false,
      isConditionalType: () => false,
      isSubstitutionType: () => false,
      isTemplateLiteralType: () => false,
      isStringMappingType: () => false,
      isTypeParameter: () => model.constraint !== undefined,
      getTypes: async () => model.members,
      getTarget: async () => fake,
    } as unknown as Type;
    models.set(id, model);
    return fake;
  }

  function model(value: Type): FakeModel {
    return models.get(value.id)!;
  }

  function property(owner: Type, name: string, value: Type, optional = false): void {
    const symbol = {
      id: nextId++ * 1000,
      name,
      escapedName: name,
      flags: SymbolFlags.Property | (optional ? SymbolFlags.Optional : 0),
    } as unknown as AsyncSymbol;
    model(owner).properties.push({ symbol, type: value });
  }

  function members(owner: Type, ...values: Type[]): void {
    model(owner).members.push(...values);
  }

  function arguments_(owner: Type, ...values: Type[]): void {
    model(owner).arguments.push(...values);
  }

  function aliasArguments(owner: Type, ...values: Type[]): void {
    model(owner).aliasArguments.push(...values);
  }

  const checker = {
    typeToString: async (value: Type) => model(value).text,
    getPropertiesOfType: async (value: Type) => model(value).properties.map((entry) => entry.symbol),
    getTypeOfSymbol: async (symbol: AsyncSymbol) => {
      for (const entry of models.values()) {
        const match = entry.properties.find((property_) => property_.symbol === symbol);
        if (match !== undefined) return match.type;
      }
      return undefined;
    },
    isArrayType: async (value: Type) => model(value).kind === "array",
    isTupleType: async (value: Type) => model(value).kind === "tuple",
    getTypeArguments: async (value: Type) => model(value).arguments,
    getSignaturesOfType: async (value: Type, kind: SignatureKind) => kind === SignatureKind.Call ? model(value).calls : model(value).constructs,
    getIndexInfosOfType: async (value: Type) => model(value).indexes,
    getConstraintOfTypeParameter: async (value: Type) => model(value).constraint,
    getReturnTypeOfSignature: async (signature: Signature) => signatureReturns.get(signature),
    getTypePredicateOfSignature: async () => undefined,
  } as unknown as Checker;

  const signatureReturns = new Map<Signature, Type>();
  function signature(owner: Type, kind: SignatureKind, parameters: Array<[string, Type]>, returns: Type): void {
    const parameterOwner = type("parameters", "object");
    for (const [name, value] of parameters) property(parameterOwner, name, value);
    const signature = {
      getTypeParameters: async () => [],
      getThisParameter: async () => undefined,
      getParameters: async () => model(parameterOwner).properties.map((entry) => entry.symbol),
      hasRestParameter: false,
    } as unknown as Signature;
    signatureReturns.set(signature, returns);
    (kind === SignatureKind.Call ? model(owner).calls : model(owner).constructs).push(signature);
  }
  function index(owner: Type, keyType: Type, valueType: Type): void {
    model(owner).indexes.push({ keyType, valueType, isReadonly: false });
  }
  return { checker, type, property, members, arguments_, aliasArguments, signature, index, model };
}

import { deferred } from "./support/deferred";

const enclosing = {} as Node;

describe("TypeGraph", () => {
  it("renders every root union member and every immediate property", async () => {
    const h = createHarness();
    const string = h.type("string");
    const a = h.type('{ kind: "a"; value: string }', "object");
    const b = h.type('{ kind: "b"; count?: number }', "object");
    h.property(a, "kind", h.type('"a"'));
    h.property(a, "value", string);
    h.property(b, "kind", h.type('"b"'));
    h.property(b, "count", h.type("number | undefined"), true);
    const rootType = h.type("Root", "union", { named: true });
    h.members(rootType, a, b);
    const graph = new TypeGraph(h.checker, enclosing, 7);
    const root = await graph.createRoot(rootType);
    const text = renderNode(root, 0);
    expect(text).toContain('kind: "a"');
    expect(text).toContain("value: string");
    expect(text).toContain("count?: number");
    expect(root.content.children).toHaveLength(2);
    expect(root.content.children!.every((edge) => edge.node.content.state === "expanded")).toBe(true);
  });

  it("enumerates root intersections member by member", async () => {
    const h = createHarness();
    const left = h.type("{ left: string }", "object");
    const right = h.type("{ right: number }", "object");
    h.property(left, "left", h.type("string"));
    h.property(right, "right", h.type("number"));
    const rootType = h.type("Combined", "intersection");
    h.members(rootType, left, right);
    const root = await new TypeGraph(h.checker, enclosing, 8).createRoot(rootType);
    const text = renderNode(root, 0);
    expect(root.content.layout).toBe("intersection");
    expect(root.content.children).toHaveLength(2);
    expect(text).toContain("left: string");
    expect(text).toContain("right: number");
  });

  it("exposes the actual types of named top-level properties and quotes their names", async () => {
    const h = createHarness();
    const named = h.type("Named<string>", "object", { named: true });
    h.property(named, "normal", h.type("string"));
    h.property(named, "not-valid", h.type("number"), true);
    const rootType = h.type("Root", "union");
    h.members(rootType, named);
    const root = await new TypeGraph(h.checker, enclosing, 1).createRoot(rootType);
    const text = renderNode(root, 0);
    expect(text).toContain("Named<string>");
    expect(text).toContain("normal: string");
    expect(text).toContain('"not-valid"?: number');
    expect(quotePropertyName("alpha_$1")).toBe("alpha_$1");
    expect(quotePropertyName("with space")).toBe('"with space"');
  });

  it("materializes one node level, detects branch cycles, and allows sibling reuse", async () => {
    const h = createHarness();
    const recursive = h.type("Recursive", "object", { named: true });
    h.property(recursive, "self", recursive);
    const rootType = h.type("Root", "object");
    h.property(rootType, "left", recursive);
    h.property(rootType, "right", recursive);
    const graph = new TypeGraph(h.checker, enclosing, 3);
    const root = await graph.createRoot(rootType);
    const left = root.content.children![0]!.node;
    const right = root.content.children![1]!.node;
    expect(left.content.state).toBe("collapsed");
    expect(right.content.state).toBe("collapsed");
    await graph.toggle(left.viewNodeId);
    expect(left.content.state).toBe("expanded");
    expect(left.content.children![0]!.node.content.state).toBe("recursive");
    expect(right.content.state).toBe("collapsed");
    await graph.toggle(right.viewNodeId);
    expect(right.content.state).toBe("expanded");
  });

  it("expands only the current visible frontier and collapse-all removes descendants", async () => {
    const h = createHarness();
    const deep = h.type("Deep", "object", { named: true });
    h.property(deep, "value", h.type("string"));
    const middle = h.type("Middle", "object", { named: true });
    h.property(middle, "deep", deep);
    const rootType = h.type("Root", "object");
    h.property(rootType, "first", middle);
    h.property(rootType, "second", middle);
    const graph = new TypeGraph(h.checker, enclosing, 4);
    const root = await graph.createRoot(rootType);
    await graph.expandFrontier();
    expect(root.content.children!.map((edge) => edge.node.content.state)).toEqual(["expanded", "expanded"]);
    expect(root.content.children![0]!.node.content.children![0]!.node.content.state).toBe("collapsed");
    await graph.collapseAll();
    expect(root.content.children!.map((edge) => edge.node.content.state)).toEqual(["collapsed", "collapsed"]);
    await expect(graph.toggle("4:9999")).rejects.toThrow("obsolete");
  });

  it("expands arrays and tuples through semantic element types", async () => {
    const h = createHarness();
    const element = h.type("Element", "object", { named: true });
    h.property(element, "id", h.type("string"));
    const array = h.type("Element[]", "array");
    h.arguments_(array, element);
    const tuple = h.type("[Element, number]", "tuple");
    h.arguments_(tuple, element, h.type("number"));
    const rootType = h.type("Root", "object");
    h.property(rootType, "items", array);
    h.property(rootType, "pair", tuple);
    const graph = new TypeGraph(h.checker, enclosing, 5);
    const root = await graph.createRoot(rootType);
    await graph.toggle(root.content.children![0]!.node.viewNodeId);
    await graph.toggle(root.content.children![1]!.node.viewNodeId);
    expect(root.content.children![0]!.node.content.layout).toBe("array");
    expect(root.content.children![0]!.node.content.children![0]!.node.text).toBe("Element");
    expect(root.content.children![1]!.node.content.layout).toBe("tuple");
    expect(root.content.children![1]!.node.content.children).toHaveLength(2);
  });

  it("retains compiler-rendered generic arguments in collapsed alias labels", async () => {
    const h = createHarness();
    const generic = h.type("{ value: string }", "object", { named: true, aliasName: "Box" });
    h.aliasArguments(generic, h.type("string"));
    h.property(generic, "value", h.type("string"));
    const rootType = h.type("Root", "object");
    h.property(rootType, "generic", generic);
    const root = await new TypeGraph(h.checker, enclosing, 9).createRoot(rootType);
    expect(root.content.children![0]!.node.text).toBe("Box<string>");
  });

  it("expands primitive arrays and tuples down to their leaves", async () => {
    const h = createHarness();
    const array = h.type("string[]", "array");
    h.arguments_(array, h.type("string"));
    const tuple = h.type("readonly [string, number?]", "tuple");
    h.arguments_(tuple, h.type("string"), h.type("number"));
    const rootType = h.type("Root", "object");
    h.property(rootType, "values", array);
    h.property(rootType, "pair", tuple);
    const graph = new TypeGraph(h.checker, enclosing, 10);
    const root = await graph.createRoot(rootType);
    await graph.expandFrontier();
    expect(root.content.children![0]!.node.content.children![0]!.node).toMatchObject({ text: "string", content: { state: "leaf", layout: "atom" } });
    expect(root.content.children![1]!.node.content.children!.map((edge) => edge.node.content.state)).toEqual(["leaf", "leaf"]);
    expect(renderNode(root, 0)).toContain("readonly [string, number?]");
  });

  it("lets anonymous union members collapse and expand their nested properties", async () => {
    const h = createHarness();
    const member = h.type("{ nested: { value: string } }", "object");
    const nested = h.type("{ value: string }", "object");
    h.property(nested, "value", h.type("string"));
    h.property(member, "nested", nested);
    const union = h.type("Union", "union");
    h.members(union, member, h.type("null"));
    const graph = new TypeGraph(h.checker, enclosing, 11);
    const root = await graph.createRoot(union);
    const branch = root.content.children![0]!.node;
    const childId = branch.content.children![0]!.node.viewNodeId;
    await graph.toggle(childId);
    expect(branch.content.children![0]!.node.content.children![0]!.node.text).toBe("string");
    await graph.toggle(branch.viewNodeId);
    expect(branch.content.state).toBe("collapsed");
    await expect(graph.toggle(childId)).rejects.toThrow("obsolete");
    await graph.toggle(branch.viewNodeId);
    expect(branch.content.children![0]!.node.content.state).toBe("collapsed");
  });

  it("exposes callable parameters, returns, constructors, and index values alongside properties", async () => {
    const h = createHarness();
    const string = h.type("string");
    const nested = h.type("{ value: string }", "object");
    h.property(nested, "value", string);
    const callable = h.type("{ (input: string): { value: string }; new (): { value: string }; [key: string]: unknown; label: string }", "object");
    h.property(callable, "label", string);
    h.signature(callable, SignatureKind.Call, [["input", string]], nested);
    h.signature(callable, SignatureKind.Construct, [], nested);
    h.index(callable, string, nested);
    const graph = new TypeGraph(h.checker, enclosing, 12);
    const root = await graph.createRoot(callable);
    expect(root.content.children!.map((edge) => edge.label)).toEqual(["label", "call", "new", "[key: string]"]);
    await graph.toggle(root.content.children![1]!.node.viewNodeId);
    const signature = root.content.children![1]!.node;
    expect(signature.content.children!.map((edge) => edge.label)).toEqual(["input", "return"]);
    expect(signature.content.children![0]!.node).toMatchObject({ text: "string", content: { state: "leaf", layout: "atom" } });
    await graph.toggle(signature.content.children![1]!.node.viewNodeId);
    expect(signature.content.children![1]!.node.content.children![0]!.node.text).toBe("string");
    await graph.toggle(root.content.children![3]!.node.viewNodeId);
    expect(root.content.children![3]!.node.content.children![0]!.node.text).toBe("string");
    expect(renderNode(root, 0)).toContain(h.model(callable).text);
  });

  it("expands constrained type parameters", async () => {
    const h = createHarness();
    const parameter = h.type("T");
    const constraint = h.type("{ id: string }", "object");
    h.property(constraint, "id", h.type("string"));
    h.model(parameter).constraint = constraint;
    const graph = new TypeGraph(h.checker, enclosing, 13);
    const root = await graph.createRoot(parameter);
    expect(root.content.children![0]!.label).toBe("constraint");
    await graph.toggle(root.content.children![0]!.node.viewNodeId);
    expect(root.content.children![0]!.node.content.children![0]!.node.text).toBe("string");
  });

  it("exposes type arguments even when a generic object has no properties", async () => {
    const h = createHarness();
    const payload = h.type("{ value: number }", "object");
    h.property(payload, "value", h.type("number"));
    const generic = h.type("Phantom<{ value: number }>", "object", { named: true, aliasName: "Phantom" });
    h.aliasArguments(generic, payload);
    const type = h.type("Root", "object");
    h.property(type, "generic", generic);
    const graph = new TypeGraph(h.checker, enclosing, 17);
    const root = await graph.createRoot(type);
    const child = root.content.children![0]!.node;
    expect(child.content.state).toBe("collapsed");
    await graph.toggle(child.viewNodeId);
    const argument = child.content.children![0]!;
    expect(argument).toMatchObject({ role: "typeArgument", label: "type argument 1" });
    await graph.toggle(argument.node.viewNodeId);
    expect(argument.node.content.children![0]!.node).toMatchObject({ text: "number", content: { state: "leaf", layout: "atom" } });
    expect(renderNode(root, 0)).not.toContain("type argument 1:");
  });

  it("supports root disclosure and restores the initial shape without reusing obsolete IDs", async () => {
    const h = createHarness();
    const type = h.type("{ value: string }", "object");
    h.property(type, "value", h.type("string"));
    const graph = new TypeGraph(h.checker, enclosing, 14);
    const root = await graph.createRoot(type);
    const initial = renderNode(root, 0);
    const oldId = root.viewNodeId;
    await graph.toggle(oldId);
    expect(root.content.state).toBe("collapsed");
    await graph.collapseAll();
    expect(root.content.state).toBe("expanded");
    expect(renderNode(root, 0)).toBe(initial);
    expect(root.viewNodeId).not.toBe(oldId);
    await expect(graph.toggle(oldId)).rejects.toThrow("obsolete");
  });

  it("serializes rapid toggles so two clicks do not leave duplicate descendants", async () => {
    const h = createHarness();
    const nested = h.type("Nested", "object");
    h.property(nested, "value", h.type("string"));
    const type = h.type("Root", "object");
    h.property(type, "nested", nested);
    const graph = new TypeGraph(h.checker, enclosing, 15);
    const root = await graph.createRoot(type);
    const child = root.content.children![0]!.node;
    await Promise.all([graph.toggle(child.viewNodeId), graph.toggle(child.viewNodeId)]);
    expect(child.content.state).toBe("collapsed");
    expect(child.content.children).toBeUndefined();
  });

  it("rejects oversized leaf expansions and leaves the previous branch intact", async () => {
    const h = createHarness();
    const large = h.type("Large", "object");
    for (let index = 0; index < 5000; index++) h.property(large, `value${index}`, h.type("string"));
    const type = h.type("Root", "object");
    h.property(type, "large", large);
    const graph = new TypeGraph(h.checker, enclosing, 16);
    const root = await graph.createRoot(type);
    const child = root.content.children![0]!.node;
    const before = renderNode(root, 0);
    await expect(graph.toggle(child.viewNodeId)).rejects.toThrow("5,000-node");
    expect(child.content.state).toBe("collapsed");
    expect(child.content.children).toBeUndefined();
    expect(renderNode(root, 0)).toBe(before);
  });
  it("drains active graph work and rejects queued work before releasing its snapshot", async () => {
    const h = createHarness();
    const nested = h.type("Nested", "object");
    const string = h.type("string");
    h.property(nested, "value", string);
    const type = h.type("Root", "object");
    h.property(type, "nested", nested);
    const graph = new TypeGraph(h.checker, enclosing, 17);
    const root = await graph.createRoot(type);
    const child = root.content.children![0]!.node;
    const started = deferred<void>();
    const response = deferred<Type>();
    vi.spyOn(h.checker as unknown as { getTypeOfSymbol(symbol: AsyncSymbol): Promise<Type | undefined> }, "getTypeOfSymbol").mockImplementationOnce(async () => {
      started.resolve();
      return response.promise;
    });
    const active = graph.toggle(child.viewNodeId);
    const queued = graph.toggle(child.viewNodeId);
    const rejected = expect(queued).rejects.toThrow("disposed");
    await started.promise;
    let disposed = false;
    const disposing = graph.disposeAsync().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    response.resolve(string);
    await Promise.all([active, rejected, disposing]);
    await expect(graph.toggle(child.viewNodeId)).rejects.toThrow("disposed");
  });

});
