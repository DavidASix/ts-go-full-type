import {
  createScanner, isArrayTypeNode, isIdentifier, isStringLiteral, isNumericLiteral, isCallSignatureDeclaration, isConditionalTypeNode,
  isConstructSignatureDeclaration, isConstructorTypeNode, isFunctionTypeNode,
  isIndexedAccessTypeNode, isIntersectionTypeNode, isIndexSignatureDeclaration, isMethodSignatureDeclaration, isNamedTupleMember,
  isOptionalTypeNode, isParenthesizedTypeNode, isPropertySignatureDeclaration, isRestTypeNode,
  isTemplateLiteralTypeNode, isTupleTypeNode, isTypeLiteralNode, isTypeOperatorNode,
  isTypePredicateNode, isTypeReferenceNode, SyntaxKind, visitEachChild,
  type FunctionLikeBase, type Node, type TypeNode,
} from "typescript/unstable/ast";
import { createIdentifier, createTypeReferenceNode } from "typescript/unstable/ast/factory";
import { settleQueries } from "../shared/async";
import type { TypeExpressionPart, TypeRenderEdge } from "../shared/protocol";

interface Binding {
  readonly node: TypeNode;
  readonly path: readonly number[];
}

/** Preserve compiler grammar while exposing only API-derived semantic child slots. */
export async function buildTypeExpression(
  syntax: Node,
  children: readonly TypeRenderEdge[],
  print: (node: Node) => Promise<string>,
): Promise<readonly TypeExpressionPart[]> {
  const bindings = bindChildren(syntax, children);
  const names = new Set<string>();
  /**
   * Collect identifiers so generated expression placeholders cannot collide with user names.
   * @param node Syntax or presentation node being processed.
   */
  const collect = (node: Node): void => {
    if (isIdentifier(node)) names.add(node.text);
    node.forEachChild(collect);
  };
  collect(syntax);
  let prefix = "__fullTypeViewer_slot_";
  while ([...names].some((name) => name.startsWith(prefix))) prefix += "_";
  const replacements = new Map<Node, string>(bindings.map((binding, index) => [binding.node, `${prefix}${index}`]));
  /**
   * Replace bound type-node positions while retaining surrounding compiler syntax.
   * @param node Syntax or presentation node being processed.
   */
  const visit = (node: Node): Node => {
    const name = replacements.get(node);
    return name === undefined ? visitEachChild(node, visit) : createTypeReferenceNode(createIdentifier(name));
  };
  const template = await print(visit(syntax));
  const fallbacks = await settleQueries(bindings.map((binding) => print(binding.node)));
  const slots = new Map(bindings.map((binding, index) => [`${prefix}${index}`, { path: binding.path, fallback: fallbacks[index]! }]));
  const scanner = createScanner(false, undefined, template);
  const parts: TypeExpressionPart[] = [];
  let start = 0;
  const templateBraces: number[] = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (kind === SyntaxKind.OpenBraceToken && templateBraces.length > 0) templateBraces[templateBraces.length - 1]!++;
    if (kind === SyntaxKind.CloseBraceToken && templateBraces.length > 0) {
      if (templateBraces.at(-1) === 0) kind = scanner.reScanTemplateToken(false);
      else templateBraces[templateBraces.length - 1]!--;
    }
    if (kind === SyntaxKind.TemplateHead) templateBraces.push(0);
    if (kind === SyntaxKind.TemplateTail) templateBraces.pop();
    const slot = kind === SyntaxKind.Identifier ? slots.get(scanner.getTokenText()) : undefined;
    if (slot === undefined) continue;
    parts.push(template.slice(start, scanner.getTokenStart()), slot);
    start = scanner.getTokenEnd();
  }
  parts.push(template.slice(start));
  return parts;
}

/** Bind type-node positions, never type relationships inferred from printed text. */
function bindChildren(syntax: Node, children: readonly TypeRenderEdge[]): Binding[] {
  const node = unwrap(syntax);
  if (isTupleTypeNode(node)) return node.elements.flatMap((element, index) => {
    if (children[index] === undefined) return [];
    return [{ node: tupleElementType(element), path: [index] }];
  });
  if (isIndexedAccessTypeNode(node)) return [{ node: node.objectType, path: [0] }, { node: node.indexType, path: [1] }];
  if (isConditionalTypeNode(node)) return [node.checkType, node.extendsType, node.trueType, node.falseType]
    .map((child, index) => ({ node: child, path: [index] }));
  if (isTemplateLiteralTypeNode(node)) return node.templateSpans.map((span, index) => ({ node: span.type, path: [index] }));
  if (isTypeOperatorNode(node)) return [{ node: node.type, path: [0] }];
  if (isIntersectionTypeNode(node) && children[0]?.label === "base") return node.types.map((child, index) => ({ node: child, path: [index] }));
  if (isTypeReferenceNode(node) && children[0]?.label === "target") return (node.typeArguments ?? []).map((child, index) => ({ node: child, path: [index] }));
  if (isTypeReferenceNode(node)) return (node.typeArguments ?? []).flatMap((argument, index) => {
    const edgeIndex = children.findIndex((edge) => edge.role === "typeArgument" && edge.label === `type argument ${index + 1}`);
    return edgeIndex < 0 ? [] : [{ node: argument, path: [edgeIndex] }];
  });
  if (isFunctionTypeNode(node) || isConstructorTypeNode(node)) return bindSignature(node, [0]);
  if (isCallSignatureDeclaration(node) || isConstructSignatureDeclaration(node)) return bindSignature(node, []);
  if (!isTypeLiteralNode(node)) return [];
  let call = 0;
  let construct = 0;
  let index = 0;
  const calls = children.flatMap((edge, edgeIndex) => edge.role === "call" ? [edgeIndex] : []);
  const constructs = children.flatMap((edge, edgeIndex) => edge.role === "construct" ? [edgeIndex] : []);
  const indexes = children.flatMap((edge, edgeIndex) => edge.role === "index" ? [edgeIndex] : []);
  const methodOverloads = new Map<number, number>();
  const bindings: Binding[] = [];
  for (const member of node.members) {
    if (isPropertySignatureDeclaration(member) || isMethodSignatureDeclaration(member)) {
      const name = member.name;
      const label = isIdentifier(name) || isNumericLiteral(name) ? name.text : isStringLiteral(name) ? JSON.stringify(name.text) : undefined;
      const edgeIndex = children.findIndex((edge) => label !== undefined && edge.label === label);
      if (edgeIndex < 0) continue;
      if (isMethodSignatureDeclaration(member)) {
        const overload = methodOverloads.get(edgeIndex) ?? 0;
        methodOverloads.set(edgeIndex, overload + 1);
        bindings.push(...bindSignature(member, [edgeIndex, overload]));
      } else if (member.type !== undefined) bindings.push({ node: member.type, path: [edgeIndex] });
    } else if (isCallSignatureDeclaration(member) || isConstructSignatureDeclaration(member)) {
      const edgeIndex = isCallSignatureDeclaration(member) ? calls[call++] : constructs[construct++];
      if (edgeIndex !== undefined) bindings.push(...bindSignature(member, [edgeIndex]));
    } else if (isIndexSignatureDeclaration(member) && member.type !== undefined) {
      const edgeIndex = indexes[index++];
      if (edgeIndex !== undefined) bindings.push({ node: member.type, path: [edgeIndex] });
    }
  }
  return bindings;
}

/** Match signature child order to compiler parameter and return annotations. */
function bindSignature(node: FunctionLikeBase, prefix: readonly number[]): Binding[] {
  const bindings: Binding[] = [];
  const offset = node.typeParameters?.length ?? 0;
  for (const [index, parameter] of (node.typeParameters ?? []).entries()) {
    if (parameter.constraint !== undefined) bindings.push({ node: parameter.constraint, path: [...prefix, index, 0] });
  }
  for (const [index, parameter] of node.parameters.entries()) {
    if (parameter.type !== undefined) bindings.push({ node: parameter.type, path: [...prefix, offset + index] });
  }
  if (node.type !== undefined) {
    const returnIndex = offset + node.parameters.length;
    if (isTypePredicateNode(node.type)) {
      if (node.type.type !== undefined) bindings.push({ node: node.type.type, path: [...prefix, returnIndex + 1] });
    } else bindings.push({ node: node.type, path: [...prefix, returnIndex] });
  }
  return bindings;
}

/** Keep labels and optional/rest wrappers outside the replaceable tuple type. */
export function tupleElementType(node: TypeNode): TypeNode {
  if (isRestTypeNode(node) || (isNamedTupleMember(node) && node.dotDotDotToken !== undefined)) return isArrayTypeNode(node.type) ? node.type.elementType : node.type;
  if (isNamedTupleMember(node) || isOptionalTypeNode(node)) return node.type;
  return node;
}

/** Peel presentation wrappers without removing semantic operators such as keyof. */
export function unwrap(node: Node): Node {
  if (isParenthesizedTypeNode(node) || (isTypeOperatorNode(node) && node.operator === SyntaxKind.ReadonlyKeyword)) return unwrap(node.type);
  return node;
}
