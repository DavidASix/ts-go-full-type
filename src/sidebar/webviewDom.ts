function key(node: Node): string | undefined {
  return node instanceof Element ? node.getAttribute("data-key") ?? undefined : undefined;
}
function compatible(current: Node, incoming: Node): boolean {
  return current.nodeType === incoming.nodeType && current.nodeName === incoming.nodeName && key(current) === key(incoming);
}

/** Reuse unchanged DOM nodes so browser focus and selection stay attached to them. */
export function reconcileChildren(current: Element, incoming: Element, preserveDetails: boolean): void {
  const originals = [...current.childNodes];
  const keyed = new Map(originals.flatMap((node) => key(node) === undefined ? [] : [[key(node)!, node] as const]));
  const retained = new Set<Node>();
  let cursor = current.firstChild;
  for (const next of [...incoming.childNodes]) {
    const matching = key(next) === undefined ? cursor : keyed.get(key(next)!);
    const node = matching !== null && matching !== undefined && compatible(matching, next) ? matching : next.cloneNode(true);
    if (node !== cursor) current.insertBefore(node, cursor);
    retained.add(node);
    if (node instanceof Element && next instanceof Element) {
      for (const attribute of [...node.attributes]) {
        if (!next.hasAttribute(attribute.name) && !(preserveDetails && node.tagName === "DETAILS" && attribute.name === "open")) {
          node.removeAttribute(attribute.name);
        }
      }
      for (const attribute of [...next.attributes]) {
        if (node.getAttribute(attribute.name) !== attribute.value) node.setAttribute(attribute.name, attribute.value);
      }
      reconcileChildren(node, next, preserveDetails);
    } else if (node.nodeValue !== next.nodeValue) node.nodeValue = next.nodeValue;
    cursor = node.nextSibling;
  }
  for (const node of originals) if (!retained.has(node)) node.remove();
}
