import type { NodeContent, TypeRenderNode } from "../src/shared/protocol";

// @ts-expect-error Collapsed presentations cannot retain expanded children.
const collapsed: NodeContent = { state: "collapsed", layout: "atom", children: [] };
// @ts-expect-error Expanded presentations require an explicit structural layout and children.
const incomplete: NodeContent = { state: "expanded", layout: "object" };
declare const rendered: TypeRenderNode;
// @ts-expect-error Consumers cannot mutate graph-owned presentation.
rendered.content = { state: "leaf", layout: "atom" };
void collapsed;
void incomplete;
