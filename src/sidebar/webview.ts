import { parseWebviewUpdate } from "../shared/protocol";
import { reconcileChildren } from "./webviewDom";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: SavedTreeState): void;
};

interface SavedTreeState {
  readonly generation: string;
  readonly focusId: string;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly focused?: boolean;
  readonly metadataOpen?: boolean;
}

const vscode = acquireVsCodeApi();
let tree = document.querySelector<HTMLElement>('[role="tree"]');
let scrollSurface = document.querySelector<HTMLElement>(".scroll");
const contextMenu = document.getElementById("context-menu");
let contextNodeId: string | undefined;
let contextTarget: "symbol" | "type" = "type";
let contextItem: HTMLElement | undefined;

interface ContextMenuAction {
  readonly id: string;
  readonly label: string;
  run(viewNodeId: string, target: "symbol" | "type"): void;
}

/** Ordered actions make adding future node commands independent of menu plumbing. */
const contextMenuActions: readonly ContextMenuAction[] = [
  { id: "go-to-definition", label: "Go to Definition", run: (viewNodeId, target) => vscode.postMessage({ type: "goToDefinition", viewNodeId, target }) },
  { id: "cancel", label: "Cancel", run: () => {} },
];

function closeContextMenu(restoreFocus = false): void {
  if (contextMenu === null) return;
  const item = contextItem;
  contextMenu.hidden = true;
  contextNodeId = undefined;
  contextItem = undefined;
  if (restoreFocus && item?.isConnected === true) focus(item, true);
}

function showContextMenu(item: HTMLElement, target: "symbol" | "type", clientX: number, clientY: number): void {
  if (contextMenu === null || item.dataset.nodeId === undefined) return;
  contextNodeId = item.dataset.nodeId;
  contextTarget = target;
  contextItem = item;
  contextMenu.hidden = false;
  contextMenu.style.left = `${clientX}px`;
  contextMenu.style.top = `${clientY}px`;
  const bounds = contextMenu.getBoundingClientRect();
  contextMenu.style.left = `${Math.max(0, Math.min(clientX, window.innerWidth - bounds.width))}px`;
  contextMenu.style.top = `${Math.max(0, Math.min(clientY, window.innerHeight - bounds.height))}px`;
  contextMenu.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
}

if (contextMenu !== null) {
  for (const action of contextMenuActions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action.id;
    button.setAttribute("role", "menuitem");
    button.textContent = action.label;
    contextMenu.append(button);
  }
  contextMenu.addEventListener("click", (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>("button[data-action]") : null;
    const action = contextMenuActions.find((candidate) => candidate.id === button?.dataset.action);
    const viewNodeId = contextNodeId;
    closeContextMenu(action?.id === "cancel");
    if (action !== undefined && viewNodeId !== undefined) action.run(viewNodeId, contextTarget);
  });
}

/**
 * Recover persisted tree navigation state from the webview API.
 */
function readState(): Partial<SavedTreeState> | undefined {
  const value = vscode.getState();
  return typeof value === "object" && value !== null ? value as Partial<SavedTreeState> : undefined;
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

/**
 * Persist the current row, scroll position, and metadata disclosure state.
 * @param item Visible tree row or focused DOM row.
 */
function save(item: HTMLElement | null = document.activeElement as HTMLElement | null): void {
  if (tree === null || scrollSurface === null) return;
  const previous = readState();
  vscode.setState({
    generation: tree.dataset.generation ?? "",
    focusId: item?.dataset.nodeId ?? previous?.focusId ?? "",
    scrollTop: scrollSurface.scrollTop,
    scrollLeft: scrollSurface.scrollLeft,
    focused: item?.getAttribute("role") === "treeitem",
    metadataOpen: document.querySelector<HTMLDetailsElement>(".metadata")?.open ?? false,
  });
}

/**
 * Move the roving tab stop and reveal the selected row without scrolling the document.
 * @param item Visible tree row or focused DOM row.
 * @param preventScroll Whether focus should preserve the current scroll position.
 */
function focus(item: HTMLElement | undefined, preventScroll = false): void {
  if (item === undefined) return;
  for (const row of items()) row.tabIndex = row === item ? 0 : -1;
  if (document.activeElement !== item) item.focus({ preventScroll: true });
  if (!preventScroll && scrollSurface !== null) {
    const row = item.querySelector(".tree-row")?.getBoundingClientRect();
    const surface = scrollSurface.getBoundingClientRect();
    if (row !== undefined) {
      if (row.top < surface.top) scrollSurface.scrollTop += row.top - surface.top;
      else if (row.bottom > surface.bottom) scrollSurface.scrollTop += row.bottom - surface.bottom;
    }
  }
  save(item);
}

/**
 * Post a disclosure request only for rows that expose an expansion state.
 * @param item Visible tree row or focused DOM row.
 */
function toggle(item: HTMLElement): void {
  const viewNodeId = item.dataset.nodeId;
  if (!item.hasAttribute("aria-expanded") || viewNodeId === undefined) return;
  save(item);
  vscode.postMessage({ type: "toggle", viewNodeId });
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  const row = event.target.closest<HTMLElement>(".tree-row");
  const item = row?.parentElement;
  if (item?.getAttribute("role") !== "treeitem") return;
  focus(item, true);
  toggle(item);
});

document.addEventListener("contextmenu", (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  const item = event.target.closest<HTMLElement>(".tree-row")?.parentElement;
  if (item?.getAttribute("role") !== "treeitem") return;
  event.preventDefault();
  focus(item, true);
  const target = event.target.closest(".tree-label") === null ? "type" : "symbol";
  showContextMenu(item, target, event.clientX, event.clientY);
});

document.addEventListener("pointerdown", (event) => {
  if (contextMenu !== null && !contextMenu.hidden && event.target instanceof Node && !contextMenu.contains(event.target)) closeContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && contextMenu?.hidden === false) {
    closeContextMenu(true);
    event.preventDefault();
    return;
  }
  if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "treeitem") return;
  const item = event.target;
  const rows = items();
  const index = rows.indexOf(item);
  switch (event.key) {
    case "ArrowDown": focus(rows[index + 1]); break;
    case "ArrowUp": focus(rows[index - 1]); break;
    case "Home": focus(rows[0]); break;
    case "End": focus(rows.at(-1)); break;
    case "ArrowRight":
      if (item.getAttribute("aria-expanded") === "false") toggle(item);
      else if (item.getAttribute("aria-expanded") === "true") {
        focus(item.querySelector<HTMLElement>('[role="group"] [role="treeitem"]') ?? undefined);
      }
      break;
    case "ArrowLeft":
      if (item.getAttribute("aria-expanded") === "true") toggle(item);
      else focus(item.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined);
      break;
    case "Enter":
    case " ": toggle(item); break;
    default: return;
  }
  event.preventDefault();
});

/**
 * Restore navigation for the same symbol and reset it when the generation changes.
 * @param saved Previously persisted webview navigation state.
 */
function restore(saved: Partial<SavedTreeState> | undefined): void {
  if (tree === null) return;
  if (saved !== undefined && saved.generation === tree.dataset.generation) {
    const target = items().find((item) => item.dataset.nodeId === saved.focusId) ?? items()[0];
    if (saved.focused === true) focus(target, true);
    else if (target !== undefined) {
      for (const row of items()) row.tabIndex = row === target ? 0 : -1;
    }
    if (scrollSurface !== null) {
      scrollSurface.scrollTop = typeof saved.scrollTop === "number" ? saved.scrollTop : 0;
      scrollSurface.scrollLeft = typeof saved.scrollLeft === "number" ? saved.scrollLeft : 0;
    }
    const metadata = document.querySelector<HTMLDetailsElement>(".metadata");
    if (metadata !== null && typeof saved.metadataOpen === "boolean") metadata.open = saved.metadataOpen;
  } else {
    // A new symbol starts at its root without stealing focus from the editor.
    if (scrollSurface !== null) { scrollSurface.scrollTop = 0; scrollSurface.scrollLeft = 0; }
    vscode.setState({ generation: tree.dataset.generation ?? "", focusId: "", scrollTop: 0, scrollLeft: 0 });
  }
}

const content = document.getElementById("content");
let lastHtml: string | undefined;
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const update = parseWebviewUpdate(event.data);
  if (update === undefined || content === null) return;
  closeContextMenu();
  const palette = document.getElementById("theme-palette");
  if (palette !== null) palette.textContent = `.type-tree {\n${update.paletteCss}\n}`;
  if (update.html === lastHtml) return;
  const selection = window.getSelection();
  const selected = selection?.anchorNode != null && selection.focusNode != null ? {
    anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focus: selection.focusNode, focusOffset: selection.focusOffset,
  } : undefined;
  save();
  const saved = readState();
  const sameSymbol = tree !== null && tree.dataset.generation === update.generation;
  const ancestors: string[] = [];
  for (let item = document.activeElement?.closest<HTMLElement>('[role="treeitem"]'); item != null;
    item = item.parentElement?.closest<HTMLElement>('[role="treeitem"]')) {
    if (item.dataset.nodeId !== undefined) ancestors.push(item.dataset.nodeId);
  }
  const incoming = document.createElement("template");
  incoming.innerHTML = update.html;
  const wrapper = document.createElement("div");
  wrapper.append(incoming.content);
  reconcileChildren(content, wrapper, sameSymbol);
  lastHtml = update.html;
  tree = document.querySelector<HTMLElement>('[role="tree"]');
  scrollSurface = document.querySelector<HTMLElement>(".scroll");
  const remaining = new Set(items().map((item) => item.dataset.nodeId));
  const focusId = ancestors.find((id) => remaining.has(id)) ?? saved?.focusId;
  restore(sameSymbol && saved !== undefined ? { ...saved, focusId: focusId ?? "" } : undefined);
  if (sameSymbol && selected?.anchor.isConnected && selected.focus.isConnected) {
    const limit = (node: Node) => node.nodeType === Node.TEXT_NODE ? node.textContent?.length ?? 0 : node.childNodes.length;
    selection?.setBaseAndExtent(selected.anchor, Math.min(selected.anchorOffset, limit(selected.anchor)),
      selected.focus, Math.min(selected.focusOffset, limit(selected.focus)));
  }
});

restore(readState());
document.addEventListener("scroll", (event) => {
  if (event.target === scrollSurface) save();
}, { capture: true, passive: true });
document.addEventListener("toggle", (event) => {
  if (event.target instanceof HTMLElement && event.target.classList.contains("metadata")) save();
}, true);
vscode.postMessage({ type: "ready" });
