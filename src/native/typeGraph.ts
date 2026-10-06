import {
  NodeBuilderFlags,
  SignatureKind,
  SymbolFlags,
  type Checker,
  type Signature,
  type Type,
} from "typescript/unstable/async";
import type { Node } from "typescript/unstable/ast";
import { UserVisibleError } from "../shared/errors";
import type { NodeLayout, TypeRenderEdge, TypeRenderNode } from "../shared/protocol";
import { hasPresentationTruncation } from "./truncation";

const PRINT_FLAGS = NodeBuilderFlags.NoTruncation |
  NodeBuilderFlags.MultilineObjectLiterals | NodeBuilderFlags.InTypeAlias;
const MAX_NODES = 5_000;
const MAX_OUTPUT = 2_000_000;

interface Materialized {
  readonly layout: NodeLayout;
  readonly children: readonly TypeRenderEdge[];
  readonly expressionText?: string;
}

interface RegistryEntry {
  readonly node: TypeRenderNode;
  readonly load: () => Promise<Materialized>;
  readonly loadBoundary?: () => Promise<Materialized>;
}

export class TypeGraph {
  private readonly registry = new Map<string, RegistryEntry>();
  private nextNodeId = 1;
  private root: TypeRenderNode | undefined;
  private rootType: Type | undefined;
  private pending: Promise<void> = Promise.resolve();

  public constructor(
    private readonly checker: Checker,
    private readonly enclosingDeclaration: Node,
    private readonly generation: number,
  ) {}

  public async createRoot(type: Type): Promise<TypeRenderNode> {
    this.registry.clear();
    this.rootType = type;
    this.root = await this.createChild(type, []);
    if (this.root.state === "collapsed") {
      await this.expandEntry(this.getEntry(this.root.viewNodeId), true);
    }
    this.assertWithinLimits();
    return this.root;
  }

  public toggle(viewNodeId: string): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.getEntry(viewNodeId);
      if (entry.node.state === "expanded") {
        this.collapseEntry(entry);
      } else {
        await this.expandEntry(entry);
      }
    });
  }

  public expandFrontier(): Promise<void> {
    return this.enqueue(async () => {
      const frontier = [...this.registry.values()].filter(
        (entry) => entry.node.state === "collapsed" && this.isVisible(entry.node),
      );
      const expanded: RegistryEntry[] = [];
      try {
        for (const entry of frontier) {
          await this.expandEntry(entry);
          expanded.push(entry);
        }
      } catch (error) {
        for (const entry of expanded) this.collapseEntry(entry);
        throw error;
      }
    });
  }

  public collapseAll(): Promise<void> {
    return this.enqueue(async () => {
      if (this.root === undefined || this.rootType === undefined) return;
      const previousRoot = this.root;
      const previousRegistry = new Map(this.registry);
      try {
        const next = await this.createRoot(this.rootType);
        Object.assign(previousRoot, next);
        this.root = previousRoot;
        const entry = this.registry.get(next.viewNodeId);
        if (entry !== undefined) this.registry.set(next.viewNodeId, { ...entry, node: previousRoot });
      } catch (error) {
        this.registry.clear();
        for (const [id, entry] of previousRegistry) this.registry.set(id, entry);
        this.root = previousRoot;
        throw error;
      }
    });
  }

  public clear(): void {
    this.registry.clear();
    this.root = undefined;
    this.rootType = undefined;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async expandEntry(entry: RegistryEntry, initial = false): Promise<void> {
    const beforeIds = new Set(this.registry.keys());
    try {
      const materialized = await entry.load();
      entry.node.state = "expanded";
      entry.node.layout = materialized.layout;
      entry.node.children = materialized.children;
      if (materialized.expressionText !== undefined) entry.node.expressionText = materialized.expressionText;
      // Keep the complete immediate root union shape visible on first focus.
      if (initial && (entry.node.layout === "union" || entry.node.layout === "intersection")) {
        for (const edge of materialized.children) {
          if (edge.node.state === "collapsed") {
            const child = this.getEntry(edge.node.viewNodeId);
            const shape = await (child.loadBoundary ?? child.load)();
            if (shape.layout === "object" || shape.layout === "details") {
              child.node.state = "expanded";
              child.node.layout = shape.layout;
              child.node.children = shape.children;
              if (shape.expressionText !== undefined) child.node.expressionText = shape.expressionText;
            } else {
              this.collectIds(shape.children).forEach((id) => this.registry.delete(id));
            }
          }
        }
      }
      this.assertWithinLimits();
    } catch (error) {
      entry.node.state = "collapsed";
      entry.node.layout = "atom";
      delete entry.node.children;
      delete entry.node.expressionText;
      for (const id of this.registry.keys()) {
        if (!beforeIds.has(id)) this.registry.delete(id);
      }
      throw error;
    }
  }

  private collapseEntry(entry: RegistryEntry): void {
    for (const id of this.collectIds(entry.node.children)) this.registry.delete(id);
    entry.node.state = "collapsed";
    entry.node.layout = "atom";
    delete entry.node.children;
    delete entry.node.expressionText;
  }

  private async materialize(type: Type, ancestors: readonly number[]): Promise<Materialized> {
    if (type.isUnionType() || type.isIntersectionType()) {
      return {
        layout: type.isUnionType() ? "union" : "intersection",
        children: await this.createChildren(await type.getTypes(), ancestors),
      };
    }
    if (await this.checker.isTupleType(type)) {
      const arguments_ = type.isTypeReference() ? await this.checker.getTypeArguments(type) : [];
      return { layout: "tuple", children: await this.createChildren(arguments_, ancestors), expressionText: await this.print(type) };
    }
    if (await this.checker.isArrayType(type)) {
      const arguments_ = type.isTypeReference() ? await this.checker.getTypeArguments(type) : [];
      return { layout: "array", children: await this.createChildren(arguments_.slice(0, 1), ancestors) };
    }
    if (type.isObjectType()) return this.materializeObject(type, ancestors);
    return { layout: "details", children: await this.typeDetails(type, ancestors), expressionText: await this.print(type) };
  }

  private async materializeObject(type: Type, ancestors: readonly number[]): Promise<Materialized> {
    const children: TypeRenderEdge[] = [];
    for (const property of await this.checker.getPropertiesOfType(type)) {
      const propertyType = await this.checker.getTypeOfSymbol(property);
      children.push({
        label: quotePropertyName(property.name),
        optional: Boolean(property.flags & SymbolFlags.Optional),
        node: propertyType === undefined ? this.leaf("unknown") : await this.createChild(propertyType, ancestors),
      });
    }
    let hasSignatures = false;
    for (const kind of [SignatureKind.Call, SignatureKind.Construct]) {
      const signatures = await this.checker.getSignaturesOfType(type, kind);
      hasSignatures ||= signatures.length > 0;
      for (const [index, signature] of signatures.entries()) {
        const label = `${kind === SignatureKind.Call ? "call" : "new"}${signatures.length > 1 ? ` ${index + 1}` : ""}`;
        const node = this.register(label, () => this.materializeSignature(signature, ancestors));
        children.push({ label, node });
      }
    }
    const indexes = await this.checker.getIndexInfosOfType(type);
    hasSignatures ||= indexes.length > 0;
    for (const index of indexes) {
      children.push({
        label: `${index.isReadonly ? "readonly " : ""}[key: ${await this.print(index.keyType)}]`,
        node: await this.createChild(index.valueType, ancestors),
      });
    }
    const arguments_ = await this.objectArguments(type);
    for (const [index, argument] of arguments_.entries()) {
      children.push({ role: "typeArgument", label: `type argument ${index + 1}`, node: await this.createChild(argument, ancestors) });
    }
    // Preserve the compiler's callable/indexed syntax in copied output. The tree
    // still exposes each signature, parameter, return, and indexed value type.
    return { layout: hasSignatures ? "details" : "object", children,
      ...(hasSignatures ? { expressionText: await this.print(type) } : {}) };
  }

  private async materializeSignature(signature: Signature, ancestors: readonly number[]): Promise<Materialized> {
    const children: TypeRenderEdge[] = [];
    for (const parameter of await signature.getTypeParameters()) {
      children.push({ label: "type parameter", node: await this.createChild(parameter, ancestors) });
    }
    const thisParameter = await signature.getThisParameter();
    const parameters = [...(thisParameter === undefined ? [] : [thisParameter]), ...await signature.getParameters()];
    for (const [index, parameter] of parameters.entries()) {
      const type = await this.checker.getTypeOfSymbol(parameter);
      children.push({
        label: `${signature.hasRestParameter && index === parameters.length - 1 ? "..." : ""}${parameter.name}`,
        optional: Boolean(parameter.flags & SymbolFlags.Optional),
        node: type === undefined ? this.leaf("unknown") : await this.createChild(type, ancestors),
      });
    }
    const returnType = await this.checker.getReturnTypeOfSignature(signature);
    if (returnType !== undefined) children.push({ label: "return", node: await this.createChild(returnType, ancestors) });
    const predicate = await this.checker.getTypePredicateOfSignature(signature);
    if (predicate?.type !== undefined) children.push({ label: "predicate", node: await this.createChild(predicate.type, ancestors) });
    return { layout: "details", children };
  }

  private async typeDetails(type: Type, ancestors: readonly number[]): Promise<TypeRenderEdge[]> {
    const values: Array<readonly [string, Type]> = [];
    if (type.isTypeParameter()) {
      const constraint = await this.checker.getConstraintOfTypeParameter(type);
      if (constraint !== undefined) values.push(["constraint", constraint]);
    } else if (type.isIndexedAccessType()) {
      values.push(["object", await type.getObjectType()], ["index", await type.getIndexType()]);
    } else if (type.isIndexType() || type.isStringMappingType()) {
      values.push(["target", await type.getTarget()]);
    } else if (type.isConditionalType()) {
      values.push(["check", await type.getCheckType()], ["extends", await type.getExtendsType()],
        ["true", await type.getTrueType()], ["false", await type.getFalseType()]);
    } else if (type.isSubstitutionType()) {
      values.push(["base", await type.getBaseType()], ["constraint", await type.getConstraint()]);
    } else if (type.isTemplateLiteralType()) {
      (await type.getTypes()).forEach((span, index) => values.push([`span ${index + 1}`, span]));
    }
    const children: TypeRenderEdge[] = [];
    for (const [label, child] of values) children.push({ label, node: await this.createChild(child, ancestors) });
    return children;
  }

  private async createChildren(types: readonly Type[], ancestors: readonly number[]): Promise<TypeRenderEdge[]> {
    const children: TypeRenderEdge[] = [];
    for (const type of types) children.push({ node: await this.createChild(type, ancestors) });
    return children;
  }

  private async createChild(type: Type, ancestors: readonly number[]): Promise<TypeRenderNode> {
    const text = await this.collapsedDisplay(type);
    if (ancestors.includes(type.id)) return { ...this.leaf(text), state: "recursive" };
    if (!(await this.isExpandable(type))) return this.leaf(await this.print(type));
    const branchAncestors = [...ancestors, type.id];
    const callable = type.isObjectType() &&
      (await this.checker.getPropertiesOfType(type)).length === 0 &&
      ((await this.checker.getSignaturesOfType(type, SignatureKind.Call)).length > 0 ||
        (await this.checker.getSignaturesOfType(type, SignatureKind.Construct)).length > 0);
    const typeKind: NodeLayout | "function" = type.isUnionType() ? "union" : type.isIntersectionType() ? "intersection"
      : await this.checker.isTupleType(type) ? "tuple" : await this.checker.isArrayType(type) ? "array"
      : callable ? "function" : type.isObjectType() ? "object" : "details";
    const node = this.register(text, () => this.materialize(type, branchAncestors), typeKind);
    if (type.isObjectType() || type.isIntersectionType()) {
      const entry = this.getEntry(node.viewNodeId);
      this.registry.set(node.viewNodeId, {
        ...entry,
        loadBoundary: async () => await this.checker.isArrayType(type) || await this.checker.isTupleType(type)
          ? this.materialize(type, branchAncestors)
          : this.materializeObject(type, branchAncestors),
      });
    }
    return node;
  }

  private register(text: string, load: () => Promise<Materialized>, typeKind: NodeLayout | "function" = "function"): TypeRenderNode {
    const node: TypeRenderNode = { viewNodeId: this.allocateId(), text, typeKind, state: "collapsed", layout: "atom" };
    this.registry.set(node.viewNodeId, { node, load });
    return node;
  }

  private leaf(text: string): TypeRenderNode {
    return { viewNodeId: this.allocateId(), text, state: "leaf", layout: "atom" };
  }

  private allocateId(): string {
    return `${this.generation}:${this.nextNodeId++}`;
  }

  private async isExpandable(type: Type): Promise<boolean> {
    if (type.isUnionType() || type.isIntersectionType() || type.isIndexedAccessType() ||
      type.isIndexType() || type.isConditionalType() || type.isSubstitutionType() ||
      type.isTemplateLiteralType() || type.isStringMappingType()) return true;
    if (type.isTypeParameter()) return (await this.checker.getConstraintOfTypeParameter(type)) !== undefined;
    if (!type.isObjectType()) return false;
    if (await this.checker.isArrayType(type) || await this.checker.isTupleType(type)) {
      return type.isTypeReference() && (await this.checker.getTypeArguments(type)).length > 0;
    }
    const [properties, calls, constructs, indexes] = await Promise.all([
      this.checker.getPropertiesOfType(type),
      this.checker.getSignaturesOfType(type, SignatureKind.Call),
      this.checker.getSignaturesOfType(type, SignatureKind.Construct),
      this.checker.getIndexInfosOfType(type),
    ]);
    return properties.length + calls.length + constructs.length + indexes.length > 0 ||
      (await this.objectArguments(type)).length > 0;
  }

  private objectArguments(type: Type): Promise<readonly Type[]> {
    return type.isTypeReference() ? this.checker.getTypeArguments(type) : type.getAliasTypeArguments();
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
    if (alias === undefined) return this.print(type);
    const arguments_ = await type.getAliasTypeArguments();
    const argumentText = await Promise.all(arguments_.map((argument) => this.print(argument)));
    return arguments_.length === 0 ? alias.name : `${alias.name}<${argumentText.join(", ")}>`;
  }

  private getEntry(viewNodeId: string): RegistryEntry {
    const entry = this.registry.get(viewNodeId);
    if (entry === undefined) throw new UserVisibleError("This expansion request is obsolete. Refresh the type and try again.");
    return entry;
  }

  private isVisible(target: TypeRenderNode): boolean {
    return this.root !== undefined && containsVisibleNode(this.root, target);
  }

  private collectIds(edges: readonly TypeRenderEdge[] | undefined): string[] {
    const ids: string[] = [];
    for (const edge of edges ?? []) {
      ids.push(edge.node.viewNodeId, ...this.collectIds(edge.node.children));
    }
    return ids;
  }

  private assertWithinLimits(): void {
    if (this.root === undefined) return;
    const { nodes, size } = measureTree(this.root);
    if (nodes > MAX_NODES) throw new UserVisibleError("Expansion would exceed the 5,000-node safety limit. The previous view was kept.");
    if (size > MAX_OUTPUT) throw new UserVisibleError("Expansion would exceed the 2 MB output safety limit. The previous view was kept.");
  }
}

function containsVisibleNode(current: TypeRenderNode, target: TypeRenderNode): boolean {
  return current === target || (current.state === "expanded" &&
    (current.children ?? []).some((edge) => containsVisibleNode(edge.node, target)));
}

function measureTree(node: TypeRenderNode): { nodes: number; size: number } {
  let nodes = 1;
  let size = node.text.length + (node.expressionText?.length ?? 0);
  if (node.state === "expanded") {
    for (const edge of node.children ?? []) {
      const child = measureTree(edge.node);
      nodes += child.nodes;
      size += (edge.label?.length ?? 0) + child.size;
    }
  }
  return { nodes, size };
}

export function quotePropertyName(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(name) ? name : JSON.stringify(name);
}
