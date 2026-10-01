import { describe, expect, it } from "vitest";
import {
  SignatureKind,
  SymbolFlags,
  type Checker,
  type Symbol as AsyncSymbol,
  type Type,
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
  readonly nonPropertyShape: boolean;
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
      nonPropertyShape: options.nonPropertyShape ?? false,
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
      isTypeParameter: () => false,
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
    getSignaturesOfType: async (value: Type, _kind: SignatureKind) => model(value).nonPropertyShape ? [{}] : [],
    getIndexInfosOfType: async () => [],
  } as unknown as Checker;

  return { checker, type, property, members, arguments_, aliasArguments };
}

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
    expect(text.match(/^\|/gm)).toHaveLength(2);
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
    expect(text).toContain("& {");
    expect(text).toContain("left: string");
    expect(text).toContain("right: number");
  });

  it("uses indexed accesses for named top-level members and quotes property names", async () => {
    const h = createHarness();
    const named = h.type("Named<string>", "object", { named: true });
    h.property(named, "normal", h.type("string"));
    h.property(named, "not-valid", h.type("number"), true);
    const rootType = h.type("Root", "union");
    h.members(rootType, named);
    const root = await new TypeGraph(h.checker, enclosing, 1).createRoot(rootType);
    const text = renderNode(root, 0);
    expect(text).toContain("// Named<string>");
    expect(text).toContain('normal: Named<string>["normal"]');
    expect(text).toContain('"not-valid"?: Named<string>["not-valid"]');
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
    const left = root.children![0]!.node;
    const right = root.children![1]!.node;
    expect(left.state).toBe("collapsed");
    expect(right.state).toBe("collapsed");
    await graph.toggle(left.viewNodeId);
    expect(left.state).toBe("expanded");
    expect(left.children![0]!.node.state).toBe("recursive");
    expect(right.state).toBe("collapsed");
    await graph.toggle(right.viewNodeId);
    expect(right.state).toBe("expanded");
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
    expect(root.children!.map((edge) => edge.node.state)).toEqual(["expanded", "expanded"]);
    expect(root.children![0]!.node.children![0]!.node.state).toBe("collapsed");
    graph.collapseAll();
    expect(root.children!.map((edge) => edge.node.state)).toEqual(["collapsed", "collapsed"]);
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
    await graph.toggle(root.children![0]!.node.viewNodeId);
    await graph.toggle(root.children![1]!.node.viewNodeId);
    expect(root.children![0]!.node.layout).toBe("array");
    expect(root.children![0]!.node.children![0]!.node.text).toBe("Element");
    expect(root.children![1]!.node.layout).toBe("tuple");
    expect(root.children![1]!.node.children).toHaveLength(2);
  });

  it("retains compiler-rendered generic arguments in collapsed alias labels", async () => {
    const h = createHarness();
    const generic = h.type("{ value: string }", "object", { named: true, aliasName: "Box" });
    h.aliasArguments(generic, h.type("string"));
    h.property(generic, "value", h.type("string"));
    const rootType = h.type("Root", "object");
    h.property(rootType, "generic", generic);
    const root = await new TypeGraph(h.checker, enclosing, 9).createRoot(rootType);
    expect(root.children![0]!.node.text).toBe("Box<string>");
  });

  it("does not offer disclosure controls for arrays of primitive leaves", async () => {
    const h = createHarness();
    const primitiveArray = h.type("string[]", "array");
    h.arguments_(primitiveArray, h.type("string"));
    const rootType = h.type("Root", "object");
    h.property(rootType, "values", primitiveArray);
    const root = await new TypeGraph(h.checker, enclosing, 10).createRoot(rootType);
    expect(root.children![0]!.node.state).toBe("leaf");
    expect(root.children![0]!.node.viewNodeId).toBe("");
  });

  it("keeps unsupported named callable shapes visible with an explicit note", async () => {
    const h = createHarness();
    const callable = h.type("CallableMember", "object", { named: true, nonPropertyShape: true });
    h.property(callable, "label", h.type("string"));
    const rootType = h.type("Root", "union");
    h.members(rootType, callable);
    const root = await new TypeGraph(h.checker, enclosing, 6).createRoot(rootType);
    const text = renderNode(root, 0);
    expect(text).toContain("CallableMember");
    expect(text).toContain("cannot safely expand");
  });
});
