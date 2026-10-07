import { expect, it, vi } from "vitest";
import { isIdentifier, isTupleTypeNode, isTypeReferenceNode, type Node } from "typescript/unstable/ast";
import { createIdentifier, createTupleTypeNode, createTypeReferenceNode } from "typescript/unstable/ast/factory";
import { buildTypeExpression } from "../src/native/typeExpression";
import { deferred } from "./support/deferred";

it("drains outstanding compiler printers before exposing a syntax failure to the snapshot owner", async () => {
  const first = createTypeReferenceNode(createIdentifier("First"));
  const second = createTypeReferenceNode(createIdentifier("Second"));
  const syntax = createTupleTypeNode([first, second]);
  const failure = new Error("Fixture printer failure");
  const delayed = deferred<string>();
  const rejected = vi.fn();
  /** Print the synthetic tuple and independently control its native child-print queries. */
  const print = async (node: Node): Promise<string> => {
    if (isTupleTypeNode(node)) return `[${node.elements.map((element) => isTypeReferenceNode(element) && isIdentifier(element.typeName) ? element.typeName.text : "unknown").join(", ")}]`;
    if (node === first) throw failure;
    return delayed.promise;
  };
  const operation = buildTypeExpression(syntax, [
    { node: { viewNodeId: "1", text: "First", content: { state: "collapsed", layout: "atom" } } },
    { node: { viewNodeId: "2", text: "Second", content: { state: "collapsed", layout: "atom" } } },
  ], print);
  const observed = operation.catch(rejected);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rejected).not.toHaveBeenCalled();
  } finally {
    delayed.resolve("Second");
    await observed;
  }
  expect(rejected).toHaveBeenCalledWith(failure);
});
