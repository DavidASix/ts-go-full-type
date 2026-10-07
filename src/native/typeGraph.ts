import {
  NodeBuilderFlags,
  SignatureKind,
  SymbolFlags,
  type Checker,
  type Project,
  type Signature,
  type Type,
} from "typescript/unstable/async";
import { SyntaxKind, type Node } from "typescript/unstable/ast";
import { settleQueries } from "../shared/async";
import { UserVisibleError } from "../shared/errors";
import type { NodeContent, NodeLayout, TypeRenderEdge, TypeRenderNode, TypeExpressionPart } from "../shared/protocol";
import { DEFAULT_GRAPH_LIMITS, GraphBudget, type GraphLimits } from "./graphBudget";
import { isReadonlyProperty } from "./propertyModifiers";
import { buildTypeExpression } from "./typeExpression";
import { hasPresentationTruncation } from "./truncation";

const PRINT_FLAGS = NodeBuilderFlags.NoTruncation |
  NodeBuilderFlags.MultilineObjectLiterals | NodeBuilderFlags.InTypeAlias;

interface Materialized {
  readonly layout: Exclude<NodeLayout, "atom">;
  readonly children: readonly TypeRenderEdge[];
  readonly expressionText?: string;
  readonly expression?: readonly TypeExpressionPart[] | undefined;
  readonly readonly?: boolean;
}

type GraphNode = Omit<TypeRenderNode, "content"> & { content: NodeContent };

interface RegistryEntry {
  readonly node: GraphNode;
  readonly load: () => Promise<Materialized>;
  readonly loadBoundary?: () => Promise<Materialized>;
}

export class TypeGraph {
  private readonly registry = new Map<string, RegistryEntry>();
  private nextNodeId = 1;
  private root: GraphNode | undefined;
  private rootType: Type | undefined;
  private pending: Promise<void> = Promise.resolve();
  private disposed = false;
  private budget = new GraphBudget(DEFAULT_GRAPH_LIMITS);

  public constructor(
    private readonly project: Pick<Project, "checker" | "emitter">,
    private readonly enclosingDeclaration: Node,
    private readonly generation: number,
    private readonly checkRequest: () => void = () => {},
    private readonly limits: GraphLimits = DEFAULT_GRAPH_LIMITS,
  ) {}

  private get checker(): Checker { return this.project.checker; }

  /** Build a compiler-printed expression with slots for semantic descendants. */
  private async expression(type: Type, children: readonly TypeRenderEdge[]): Promise<readonly TypeExpressionPart[] | undefined> {
    const syntax = await this.query(() => this.checker.typeToTypeNode(type, this.enclosingDeclaration, PRINT_FLAGS));
    if (syntax === undefined) return undefined;
    if (type.isTypeParameter() && children.length > 0) return [await this.print(type), " & ", { path: [0], fallback: children[0]!.node.text }];
    return buildTypeExpression(syntax, children, (node) => this.query(() => this.project.emitter.printNode(node)));
  }

  public async createRoot(type: Type): Promise<TypeRenderNode> {
    this.registry.clear();
    this.budget = new GraphBudget(this.limits);
    this.rootType = type;
    this.root = await this.createChild(type, []);
    if (this.root.content.state === "collapsed") {
      await this.expandEntry(this.getEntry(this.root.viewNodeId), true);
    }
    return this.root;
  }

  public toggle(viewNodeId: string): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.getEntry(viewNodeId);
      if (entry.node.content.state === "expanded") {
        this.collapseEntry(entry);
      } else {
        await this.expandEntry(entry);
      }
    });
  }

  public expandFrontier(): Promise<void> {
    return this.enqueue(async () => {
      const frontier = this.visibleFrontier();
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

  private clear(): void {
    this.registry.clear();
    this.root = undefined;
    this.rootType = undefined;
  }

  public async disposeAsync(): Promise<void> {
    this.disposed = true;
    // A snapshot must outlive every operation using its checker and type handles.
    await this.pending;
    this.clear();
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.pending.then(async () => {
      this.assertUsable();
      const usage = this.root === undefined ? { nodes: 0, size: 0 } : measureTree(this.root);
      this.budget = new GraphBudget(this.limits, usage.nodes, usage.size);
      await operation();
    });
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async expandEntry(entry: RegistryEntry, initial = false): Promise<void> {
    const beforeIds = new Set(this.registry.keys());
    try {
      const materialized = await entry.load();
      if (materialized.expressionText !== undefined) this.budget.addText(materialized.expressionText);
      if (materialized.expression !== undefined) this.budget.addText(expressionText(materialized.expression));
      entry.node.content = { state: "expanded", ...materialized };
      // Keep the complete immediate root union shape visible on first focus.
      if (initial && (entry.node.content.layout === "union" || entry.node.content.layout === "intersection")) {
        for (const edge of materialized.children) {
          if (edge.node.content.state === "collapsed") {
            const child = this.getEntry(edge.node.viewNodeId);
            const shape = await (child.loadBoundary ?? child.load)();
            if (shape.layout === "object" || shape.layout === "details") {
              if (shape.expressionText !== undefined) this.budget.addText(shape.expressionText);
              if (shape.expression !== undefined) this.budget.addText(expressionText(shape.expression));
              child.node.content = { state: "expanded", ...shape };
            } else {
              this.collectIds(shape.children).forEach((id) => this.registry.delete(id));
            }
          }
        }
      }

    } catch (error) {
      entry.node.content = { state: "collapsed", layout: "atom" };
      for (const id of this.registry.keys()) {
        if (!beforeIds.has(id)) this.registry.delete(id);
      }
      throw error;
    }
  }

  private collapseEntry(entry: RegistryEntry): void {
    for (const id of this.collectIds(entry.node.content.children)) this.registry.delete(id);
    entry.node.content = { state: "collapsed", layout: "atom" };
  }

  private async materialize(type: Type, ancestors: readonly number[]): Promise<Materialized> {
    if (type.isUnionType() || type.isIntersectionType()) {
      return {
        layout: type.isUnionType() ? "union" : "intersection",
        children: await this.createChildren(await this.query(() => type.getTypes()), ancestors),
      };
    }
    if (await this.query(() => this.checker.isTupleType(type))) {
      const arguments_ = type.isTypeReference() ? await this.query(() => this.checker.getTypeArguments(type)) : [];
      const children = await this.createChildren(arguments_, ancestors);
      return { layout: "tuple", children, expressionText: await this.print(type), expression: await this.expression(type, children) };
    }
    if (await this.query(() => this.checker.isArrayType(type))) {
      const arguments_ = type.isTypeReference() ? await this.query(() => this.checker.getTypeArguments(type)) : [];
      const target = type.isTypeReference() ? await this.query(() => type.getTarget()) : type;
      const symbol = await this.query(() => target.getSymbol());
      return { layout: "array", children: await this.createChildren(arguments_.slice(0, 1), ancestors), readonly: symbol?.name === "ReadonlyArray" };
    }
    if (type.isObjectType()) return this.materializeObject(type, ancestors);
    const children = await this.typeDetails(type, ancestors);
    return { layout: "details", children, expressionText: await this.print(type), expression: await this.expression(type, children) };
  }

  private async materializeObject(type: Type, ancestors: readonly number[]): Promise<Materialized> {
    const children: TypeRenderEdge[] = [];
    for (const property of await this.query(() => this.checker.getPropertiesOfType(type))) {
      this.budget.assertCanAddNode();
      const propertyType = await this.query(() => this.checker.getTypeOfSymbol(property));
      children.push(this.edge({
        label: quotePropertyName(property.name),
        optional: Boolean(property.flags & SymbolFlags.Optional),
        readonly: await isReadonlyProperty(property, (operation) => this.query(operation)),
        node: propertyType === undefined ? this.leaf("unknown") : await this.createChild(propertyType, ancestors),
      }));
    }
    let hasSignatures = false;
    for (const kind of [SignatureKind.Call, SignatureKind.Construct]) {
      const signatures = await this.query(() => this.checker.getSignaturesOfType(type, kind));
      hasSignatures ||= signatures.length > 0;
      for (const [index, signature] of signatures.entries()) {
        const label = `${kind === SignatureKind.Call ? "call" : "new"}${signatures.length > 1 ? ` ${index + 1}` : ""}`;
        const node = this.register(label, () => this.materializeSignature(signature, ancestors));
        children.push(this.edge({ role: kind === SignatureKind.Call ? "call" : "construct", label, node }));
      }
    }
    const indexes = await this.query(() => this.checker.getIndexInfosOfType(type));
    hasSignatures ||= indexes.length > 0;
    for (const index of indexes) {
      children.push(this.edge({
        role: "index",
        label: `${index.isReadonly ? "readonly " : ""}[key: ${await this.print(index.keyType)}]`,
        node: await this.createChild(index.valueType, ancestors),
      }));
    }
    const arguments_ = await this.objectArguments(type);
    for (const [index, argument] of arguments_.entries()) {
      children.push(this.edge({ role: "typeArgument", label: `type argument ${index + 1}`, node: await this.createChild(argument, ancestors) }));
    }
    // Preserve the compiler's callable/indexed syntax in copied output. The tree
    // still exposes each signature, parameter, return, and indexed value type.
    return { layout: hasSignatures ? "details" : "object", children,
      ...(hasSignatures ? { expressionText: await this.print(type), expression: await this.expression(type, children) } : {}) };
  }

  private async materializeSignature(signature: Signature, ancestors: readonly number[]): Promise<Materialized> {
    const children: TypeRenderEdge[] = [];
    for (const parameter of await this.query(() => signature.getTypeParameters())) {
      children.push(this.edge({ label: "type parameter", node: await this.createChild(parameter, ancestors) }));
    }
    const thisParameter = await this.query(() => signature.getThisParameter());
    const parameters = [...(thisParameter === undefined ? [] : [thisParameter]), ...await this.query(() => signature.getParameters())];
    for (const [index, parameter] of parameters.entries()) {
      const type = await this.query(() => this.checker.getTypeOfSymbol(parameter));
      children.push(this.edge({
        label: `${signature.hasRestParameter && index === parameters.length - 1 ? "..." : ""}${parameter.name}`,
        optional: Boolean(parameter.flags & SymbolFlags.Optional),
        node: type === undefined ? this.leaf("unknown") : await this.createChild(type, ancestors),
      }));
    }
    const returnType = await this.query(() => this.checker.getReturnTypeOfSignature(signature));
    if (returnType !== undefined) children.push(this.edge({ label: "return", node: await this.createChild(returnType, ancestors) }));
    const predicate = await this.query(() => this.checker.getTypePredicateOfSignature(signature));
    if (predicate?.type !== undefined) children.push(this.edge({ label: "predicate", node: await this.createChild(predicate.type, ancestors) }));
    const syntax = await this.query(() => this.checker.signatureToSignatureDeclaration(signature, SyntaxKind.CallSignature, this.enclosingDeclaration, PRINT_FLAGS));
    return { layout: "details", children,
      ...(syntax === undefined ? {} : { expression: await buildTypeExpression(syntax, children, (node) => this.query(() => this.project.emitter.printNode(node))) }) };

  }

  private async typeDetails(type: Type, ancestors: readonly number[]): Promise<TypeRenderEdge[]> {
    const values: Array<readonly [string, Type]> = [];
    if (type.isTypeParameter()) {
      const constraint = await this.query(() => this.checker.getConstraintOfTypeParameter(type));
      if (constraint !== undefined) values.push(["constraint", constraint]);
    } else if (type.isIndexedAccessType()) {
      values.push(["object", await this.query(() => type.getObjectType())], ["index", await this.query(() => type.getIndexType())]);
    } else if (type.isIndexType() || type.isStringMappingType()) {
      values.push(["target", await this.query(() => type.getTarget())]);
    } else if (type.isConditionalType()) {
      values.push(["check", await this.query(() => type.getCheckType())], ["extends", await this.query(() => type.getExtendsType())],
        ["true", await this.query(() => type.getTrueType())], ["false", await this.query(() => type.getFalseType())]);
    } else if (type.isSubstitutionType()) {
      values.push(["base", await this.query(() => type.getBaseType())], ["constraint", await this.query(() => type.getConstraint())]);
    } else if (type.isTemplateLiteralType()) {
      (await this.query(() => type.getTypes())).forEach((span, index) => values.push([`span ${index + 1}`, span]));
    }
    const children: TypeRenderEdge[] = [];
    for (const [label, child] of values) children.push(this.edge({ label, node: await this.createChild(child, ancestors) }));
    return children;
  }

  private async createChildren(types: readonly Type[], ancestors: readonly number[]): Promise<TypeRenderEdge[]> {
    const children: TypeRenderEdge[] = [];
    for (const type of types) children.push(this.edge({ node: await this.createChild(type, ancestors) }));
    return children;
  }

  private async createChild(type: Type, ancestors: readonly number[]): Promise<GraphNode> {
    this.budget.assertCanAddNode();
    const text = await this.collapsedDisplay(type);
    if (ancestors.includes(type.id)) return { ...this.leaf(text), content: { state: "recursive", layout: "atom" } };
    if (!(await this.isExpandable(type))) return this.leaf(await this.print(type));
    const branchAncestors = [...ancestors, type.id];
    const callable = type.isObjectType() &&
      (await this.query(() => this.checker.getPropertiesOfType(type))).length === 0 &&
      ((await this.query(() => this.checker.getSignaturesOfType(type, SignatureKind.Call))).length > 0 ||
        (await this.query(() => this.checker.getSignaturesOfType(type, SignatureKind.Construct))).length > 0);
    const typeKind: NodeLayout | "function" = type.isUnionType() ? "union" : type.isIntersectionType() ? "intersection"
      : await this.query(() => this.checker.isTupleType(type)) ? "tuple" : await this.query(() => this.checker.isArrayType(type)) ? "array"
      : callable ? "function" : type.isObjectType() ? "object" : "details";
    const node = this.register(text, () => this.materialize(type, branchAncestors), typeKind);
    if (type.isObjectType() || type.isIntersectionType()) {
      const entry = this.getEntry(node.viewNodeId);
      this.registry.set(node.viewNodeId, {
        ...entry,
        loadBoundary: async () => await this.query(() => this.checker.isArrayType(type)) || await this.query(() => this.checker.isTupleType(type))
          ? this.materialize(type, branchAncestors)
          : this.materializeObject(type, branchAncestors),
      });
    }
    return node;
  }

  private register(text: string, load: () => Promise<Materialized>, typeKind: NodeLayout | "function" = "function"): GraphNode {
    this.budget.addNode(text);
    const node: GraphNode = { viewNodeId: this.allocateId(), text, typeKind, content: { state: "collapsed", layout: "atom" }};
    this.registry.set(node.viewNodeId, { node, load });
    return node;
  }

  private leaf(text: string): GraphNode {
    this.budget.addNode(text);
    return { viewNodeId: this.allocateId(), text, content: { state: "leaf", layout: "atom" }};
  }

  private allocateId(): string {
    return `${this.generation}:${this.nextNodeId++}`;
  }

  private async isExpandable(type: Type): Promise<boolean> {
    if (type.isUnionType() || type.isIntersectionType() || type.isIndexedAccessType() ||
      type.isIndexType() || type.isConditionalType() || type.isSubstitutionType() ||
      type.isTemplateLiteralType() || type.isStringMappingType()) return true;
    if (type.isTypeParameter()) return (await this.query(() => this.checker.getConstraintOfTypeParameter(type))) !== undefined;
    if (!type.isObjectType()) return false;
    if (await this.query(() => this.checker.isArrayType(type)) || await this.query(() => this.checker.isTupleType(type))) {
      return type.isTypeReference() && (await this.query(() => this.checker.getTypeArguments(type))).length > 0;
    }
    const [properties, calls, constructs, indexes] = await settleQueries([
      this.query(() => this.checker.getPropertiesOfType(type)),
      this.query(() => this.checker.getSignaturesOfType(type, SignatureKind.Call)),
      this.query(() => this.checker.getSignaturesOfType(type, SignatureKind.Construct)),
      this.query(() => this.checker.getIndexInfosOfType(type)),
    ]);
    return properties.length + calls.length + constructs.length + indexes.length > 0 ||
      (await this.objectArguments(type)).length > 0;
  }

  private objectArguments(type: Type): Promise<readonly Type[]> {
    return this.query(() => type.isTypeReference() ? this.checker.getTypeArguments(type) : type.getAliasTypeArguments());
  }

  private async query<T>(operation: () => Promise<T>): Promise<T> {
    this.assertUsable();
    this.checkRequest();
    const result = await operation();
    this.assertUsable();
    this.checkRequest();
    return result;
  }

  private assertUsable(): void {
    if (this.disposed) throw new UserVisibleError("This type session has been disposed.");
  }

  private async print(type: Type): Promise<string> {
    const text = await this.query(() => this.checker.typeToString(type, this.enclosingDeclaration, PRINT_FLAGS));
    this.budget.assertTextFits(text);
    if (hasPresentationTruncation(text)) {
      throw new UserVisibleError("TypeScript returned a truncated type. Refresh after the project finishes loading.");
    }
    return text;
  }

  private async collapsedDisplay(type: Type): Promise<string> {
    const alias = await this.query(() => type.getAliasSymbol());
    if (alias === undefined) return this.print(type);
    const arguments_ = await this.query(() => type.getAliasTypeArguments());
    const argumentText = await settleQueries(arguments_.map((argument) => this.print(argument)));
    return arguments_.length === 0 ? alias.name : `${alias.name}<${argumentText.join(", ")}>`;
  }

  private getEntry(viewNodeId: string): RegistryEntry {
    const entry = this.registry.get(viewNodeId);
    if (entry === undefined) throw new UserVisibleError("This expansion request is obsolete. Refresh the type and try again.");
    return entry;
  }

  private visibleFrontier(): RegistryEntry[] {
    const frontier: RegistryEntry[] = [];
    const stack = this.root === undefined ? [] : [this.root as TypeRenderNode];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.content.state === "collapsed") frontier.push(this.getEntry(node.viewNodeId));
      else if (node.content.state === "expanded") {
        for (const edge of [...node.content.children].reverse()) stack.push(edge.node);
      }
    }
    return frontier;
  }

  private edge(edge: TypeRenderEdge): TypeRenderEdge {
    this.budget.addText((edge.label ?? "") + (edge.annotation ?? ""));
    return edge;
  }

  private collectIds(edges: readonly TypeRenderEdge[] | undefined): string[] {
    const ids: string[] = [];
    for (const edge of edges ?? []) {
      ids.push(edge.node.viewNodeId, ...this.collectIds(edge.node.content.children));
    }
    return ids;
  }

}

function measureTree(node: TypeRenderNode): { nodes: number; size: number } {
  let nodes = 1;
  let size = Buffer.byteLength(node.text + (node.content.expressionText ?? "") + expressionText(node.content.expression ?? []), "utf8");
  if (node.content.state === "expanded") {
    for (const edge of node.content.children ?? []) {
      const child = measureTree(edge.node);
      nodes += child.nodes;
      size += Buffer.byteLength((edge.label ?? "") + (edge.annotation ?? ""), "utf8") + child.size;
    }
  }
  return { nodes, size };
}

export function quotePropertyName(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(name) ? name : JSON.stringify(name);
}

/** Account for both syntax fragments and collapsed slot fallbacks in graph limits. */
function expressionText(parts: readonly TypeExpressionPart[]): string {
  return parts.map((part) => typeof part === "string" ? part : part.fallback).join("");
}
