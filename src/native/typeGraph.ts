import {
  NodeBuilderFlags,
  SignatureKind,
  SymbolFlags,
  type Checker,
  type Type,
} from "typescript/unstable/async";
import type { Node } from "typescript/unstable/ast";
import { UserVisibleError } from "../shared/errors";
import type {
  NodeLayout,
  TypeRenderEdge,
  TypeRenderNode,
} from "../shared/protocol";
import { hasPresentationTruncation } from "./truncation";

const PRINT_FLAGS =
  NodeBuilderFlags.NoTruncation |
  NodeBuilderFlags.MultilineObjectLiterals |
  NodeBuilderFlags.InTypeAlias;
const MAX_NODES = 5_000;
const MAX_OUTPUT = 2_000_000;

interface RegistryEntry {
  readonly generation: number;
  readonly type: Type;
  readonly ancestors: readonly number[];
  readonly node: TypeRenderNode;
}

interface Materialized {
  readonly layout: NodeLayout;
  readonly children: readonly TypeRenderEdge[];
  readonly note?: string;
}

export class TypeGraph {
  private readonly registry = new Map<string, RegistryEntry>();
  private nextNodeId = 1;
  private root: TypeRenderNode | undefined;

  public constructor(
    private readonly checker: Checker,
    private readonly enclosingDeclaration: Node,
    private readonly generation: number,
  ) {}

  public async createRoot(type: Type): Promise<TypeRenderNode> {
    this.registry.clear();
    this.nextNodeId = 1;
    const text = await this.print(type);
    const root: TypeRenderNode = {
      viewNodeId: "",
      text,
      state: "expanded",
      layout: "atom",
    };
    const materialized = await this.materialize(type, [type.id], true);
    root.layout = materialized.layout;
    root.children = materialized.children;
    if (materialized.note !== undefined) {
      Object.assign(root, { note: materialized.note });
    }
    this.root = root;
    this.assertWithinLimits();
    return root;
  }

  public async toggle(viewNodeId: string): Promise<void> {
    const entry = this.getEntry(viewNodeId);
    if (entry.node.state === "recursive" || entry.node.state === "leaf") {
      throw new UserVisibleError("That type cannot be expanded.");
    }
    if (entry.node.state === "expanded") {
      this.collapseEntry(entry);
      return;
    }
    await this.expandEntry(entry);
  }

  public async expandFrontier(): Promise<void> {
    const frontier = [...this.registry.values()].filter(
      (entry) => entry.node.state === "collapsed" && this.isVisible(entry.node),
    );
    const expanded: RegistryEntry[] = [];
    try {
      for (const entry of frontier) {
        await this.expandEntry(entry, false);
        expanded.push(entry);
      }
      this.assertWithinLimits();
    } catch (error) {
      for (const entry of expanded) {
        this.collapseEntry(entry);
      }
      throw error;
    }
  }

  public collapseAll(): void {
    for (const entry of this.registry.values()) {
      if (entry.node.state === "expanded") {
        this.collapseEntry(entry);
      }
    }
  }

  public clear(): void {
    this.registry.clear();
    this.root = undefined;
  }

  private async expandEntry(entry: RegistryEntry, checkLimits = true): Promise<void> {
    if (entry.ancestors.includes(entry.type.id)) {
      entry.node.state = "recursive";
      return;
    }
    const beforeIds = new Set(this.registry.keys());
    try {
      const materialized = await this.materialize(entry.type, [...entry.ancestors, entry.type.id], false);
      entry.node.state = "expanded";
      entry.node.layout = materialized.layout;
      entry.node.children = materialized.children;
      if (materialized.note !== undefined) {
        Object.assign(entry.node, { note: materialized.note });
      }
      if (checkLimits) {
        this.assertWithinLimits();
      }
    } catch (error) {
      entry.node.state = "collapsed";
      entry.node.layout = "atom";
      delete entry.node.children;
      for (const id of this.registry.keys()) {
        if (!beforeIds.has(id)) {
          this.registry.delete(id);
        }
      }
      throw error;
    }
  }

  private collapseEntry(entry: RegistryEntry): void {
    const descendantIds = new Set<string>();
    this.collectIds(entry.node.children, descendantIds);
    for (const id of descendantIds) {
      this.registry.delete(id);
    }
    entry.node.state = "collapsed";
    entry.node.layout = "atom";
    delete entry.node.children;
  }

  private async materialize(
    type: Type,
    ancestors: readonly number[],
    preservePrintedMembers: boolean,
  ): Promise<Materialized> {
    if (type.isUnionType() || type.isIntersectionType()) {
      const memberTypes = await type.getTypes();
      const children: TypeRenderEdge[] = [];
      for (const member of memberTypes) {
        if ((member.isObjectType() || member.isIntersectionType()) && !ancestors.includes(member.id)) {
          children.push({ node: await this.createBoundaryObject(member, ancestors, preservePrintedMembers) });
        } else {
          children.push({ node: await this.createChild(member, ancestors) });
        }
      }
      return {
        layout: type.isUnionType() ? "union" : "intersection",
        children,
      };
    }

    if (await this.checker.isTupleType(type)) {
      const arguments_ = type.isTypeReference()
        ? await this.checker.getTypeArguments(type)
        : [];
      return {
        layout: "tuple",
        children: await this.createUnlabelledChildren(arguments_, ancestors),
      };
    }

    if (await this.checker.isArrayType(type)) {
      const arguments_ = type.isTypeReference()
        ? await this.checker.getTypeArguments(type)
        : [];
      return {
        layout: "array",
        children: await this.createUnlabelledChildren(arguments_.slice(0, 1), ancestors),
      };
    }

    if (type.isObjectType()) {
      return this.materializeObject(type, ancestors);
    }

    return { layout: "atom", children: [] };
  }

  private async createBoundaryObject(
    type: Type,
    ancestors: readonly number[],
    preservePrintedShape: boolean,
  ): Promise<TypeRenderNode> {
    const printed = await this.print(type);
    const properties = await this.checker.getPropertiesOfType(type);
    if (properties.length === 0) {
      return { viewNodeId: "", text: printed, state: "leaf", layout: "atom" };
    }

    const alias = await type.getAliasSymbol();
    const symbol = alias ?? (await type.getSymbol());
    const namedDisplay = alias === undefined ? printed : await this.aliasDisplay(type, alias.name);
    const isNamed = alias !== undefined || (symbol !== undefined && !printed.trimStart().startsWith("{"));
    if (preservePrintedShape && !isNamed && (printed.trimStart().startsWith("{") || type.isIntersectionType())) {
      return {
        viewNodeId: "",
        text: printed,
        state: "leaf",
        layout: "atom",
      };
    }
    if (isNamed && (await this.hasNonPropertyShape(type))) {
      return {
        viewNodeId: "",
        text: namedDisplay,
        state: "leaf",
        layout: "atom",
        note: "This named member has call, construct, or index signatures; the MVP cannot safely expand it as properties.",
      };
    }

    const edges = await this.createPropertyEdges(
      type,
      [...ancestors, type.id],
      isNamed ? namedDisplay : undefined,
    );
    return {
      viewNodeId: "",
      text: isNamed ? namedDisplay : printed,
      state: "expanded",
      layout: "object",
      children: edges,
      ...(isNamed ? { provenance: namedDisplay } : {}),
    };
  }

  private async materializeObject(type: Type, ancestors: readonly number[]): Promise<Materialized> {
    const properties = await this.checker.getPropertiesOfType(type);
    if (properties.length === 0) {
      return { layout: "atom", children: [] };
    }
    if (await this.hasNonPropertyShape(type)) {
      return {
        layout: "atom",
        children: [],
        note: "This type has call, construct, or index signatures that are not expanded by this MVP.",
      };
    }
    return {
      layout: "object",
      children: await this.createPropertyEdges(type, ancestors),
    };
  }

  private async createPropertyEdges(
    owner: Type,
    ancestors: readonly number[],
    indexedOwnerText?: string,
  ): Promise<readonly TypeRenderEdge[]> {
    const properties = await this.checker.getPropertiesOfType(owner);
    const edges: TypeRenderEdge[] = [];
    for (const property of properties) {
      const propertyType = await this.checker.getTypeOfSymbol(property);
      const propertyName = quotePropertyName(property.name);
      if (propertyType === undefined) {
        edges.push({
          label: propertyName,
          optional: Boolean(property.flags & SymbolFlags.Optional),
          node: { viewNodeId: "", text: "unknown", state: "leaf", layout: "atom" },
        });
        continue;
      }
      const textOverride = indexedOwnerText === undefined
        ? undefined
        : `${indexedOwnerText}[${JSON.stringify(property.name)}]`;
      edges.push({
        label: propertyName,
        optional: Boolean(property.flags & SymbolFlags.Optional),
        ...(indexedOwnerText !== undefined && property.name === "data_type"
          ? { annotation: await this.print(propertyType) }
          : {}),
        node: await this.createChild(propertyType, ancestors, textOverride),
      });
    }
    return edges;
  }

  private async createUnlabelledChildren(
    types: readonly Type[],
    ancestors: readonly number[],
  ): Promise<readonly TypeRenderEdge[]> {
    return Promise.all(types.map(async (type) => ({ node: await this.createChild(type, ancestors) })));
  }

  private async createChild(
    type: Type,
    ancestors: readonly number[],
    textOverride?: string,
  ): Promise<TypeRenderNode> {
    const text = textOverride ?? (await this.collapsedDisplay(type));
    if (ancestors.includes(type.id)) {
      return { viewNodeId: "", text, state: "recursive", layout: "atom" };
    }
    if (!(await this.isExpandable(type))) {
      return { viewNodeId: "", text, state: "leaf", layout: "atom" };
    }
    const viewNodeId = `${this.generation}:${this.nextNodeId++}`;
    const node: TypeRenderNode = {
      viewNodeId,
      text,
      state: "collapsed",
      layout: "atom",
    };
    this.registry.set(viewNodeId, {
      generation: this.generation,
      type,
      ancestors,
      node,
    });
    return node;
  }

  private async isExpandable(type: Type): Promise<boolean> {
    if (type.isUnionType() || type.isIntersectionType()) {
      return true;
    }
    if (await this.checker.isArrayType(type) || await this.checker.isTupleType(type)) {
      if (!type.isTypeReference()) {
        return false;
      }
      const arguments_ = await this.checker.getTypeArguments(type);
      for (const argument of arguments_) {
        if (await this.hasMeaningfulStructure(argument, new Set([type.id]))) {
          return true;
        }
      }
      return false;
    }
    if (!type.isObjectType()) {
      return false;
    }
    return (await this.checker.getPropertiesOfType(type)).length > 0;
  }

  private async hasMeaningfulStructure(type: Type, seen: Set<number>): Promise<boolean> {
    if (seen.has(type.id)) {
      return true;
    }
    if (type.isUnionType() || type.isIntersectionType()) {
      return true;
    }
    if (await this.checker.isArrayType(type) || await this.checker.isTupleType(type)) {
      if (!type.isTypeReference()) {
        return false;
      }
      seen.add(type.id);
      const arguments_ = await this.checker.getTypeArguments(type);
      for (const argument of arguments_) {
        if (await this.hasMeaningfulStructure(argument, seen)) {
          return true;
        }
      }
      return false;
    }
    return type.isObjectType() && (await this.checker.getPropertiesOfType(type)).length > 0;
  }

  private async hasNonPropertyShape(type: Type): Promise<boolean> {
    const [calls, constructs, indexes] = await Promise.all([
      this.checker.getSignaturesOfType(type, SignatureKind.Call),
      this.checker.getSignaturesOfType(type, SignatureKind.Construct),
      this.checker.getIndexInfosOfType(type),
    ]);
    return calls.length > 0 || constructs.length > 0 || indexes.length > 0;
  }

  private async print(type: Type): Promise<string> {
    const text = await this.checker.typeToString(type, this.enclosingDeclaration, PRINT_FLAGS);
    if (hasPresentationTruncation(text)) {
      throw new UserVisibleError("TypeScript returned a truncated type. Refresh after the project finishes loading.");
    }
    return text;
  }

  private async collapsedDisplay(type: Type): Promise<string> {
    const alias = await type.getAliasSymbol();
    return alias === undefined ? this.print(type) : this.aliasDisplay(type, alias.name);
  }

  private async aliasDisplay(type: Type, name: string): Promise<string> {
    const arguments_ = await type.getAliasTypeArguments();
    if (arguments_.length === 0) {
      return name;
    }
    const argumentText = await Promise.all(arguments_.map(async (argument) => this.collapsedDisplay(argument)));
    return `${name}<${argumentText.join(", ")}>`;
  }

  private getEntry(viewNodeId: string): RegistryEntry {
    const entry = this.registry.get(viewNodeId);
    if (entry === undefined || entry.generation !== this.generation) {
      throw new UserVisibleError("This expansion request is obsolete. Refresh the type and try again.");
    }
    return entry;
  }

  private isVisible(target: TypeRenderNode): boolean {
    if (this.root === undefined) {
      return false;
    }
    return containsVisibleNode(this.root, target);
  }

  private collectIds(edges: readonly TypeRenderEdge[] | undefined, result: Set<string>): void {
    for (const edge of edges ?? []) {
      if (edge.node.viewNodeId.length > 0) {
        result.add(edge.node.viewNodeId);
      }
      this.collectIds(edge.node.children, result);
    }
  }

  private assertWithinLimits(): void {
    if (this.registry.size > MAX_NODES) {
      throw new UserVisibleError("Expansion would exceed the 5,000-node safety limit. The previous view was kept.");
    }
    if (this.root !== undefined && estimateTextSize(this.root) > MAX_OUTPUT) {
      throw new UserVisibleError("Expansion would exceed the 2 MB output safety limit. The previous view was kept.");
    }
  }
}

function containsVisibleNode(current: TypeRenderNode, target: TypeRenderNode): boolean {
  if (current === target) {
    return true;
  }
  if (current.state !== "expanded") {
    return false;
  }
  return (current.children ?? []).some((edge) => containsVisibleNode(edge.node, target));
}

function estimateTextSize(node: TypeRenderNode): number {
  let size = node.text.length + (node.provenance?.length ?? 0) + (node.note?.length ?? 0);
  if (node.state === "expanded") {
    for (const edge of node.children ?? []) {
      size += (edge.label?.length ?? 0) + estimateTextSize(edge.node);
    }
  }
  return size;
}

export function quotePropertyName(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(name) ? name : JSON.stringify(name);
}
