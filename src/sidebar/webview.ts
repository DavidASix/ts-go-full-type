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
}

const vscode = acquireVsCodeApi();
const tree = document.querySelector<HTMLElement>('[role="tree"]');
const scrollSurface = document.querySelector<HTMLElement>(".scroll");

function readState(): Partial<SavedTreeState> | undefined {
  const value = vscode.getState();
  return typeof value === "object" && value !== null ? value as Partial<SavedTreeState> : undefined;
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

function save(item: HTMLElement | null = document.activeElement as HTMLElement | null): void {
  if (tree === null || scrollSurface === null) return;
  const previous = readState();
  vscode.setState({
    generation: tree.dataset.generation ?? "",
    focusId: item?.dataset.nodeId ?? previous?.focusId ?? "",
    scrollTop: scrollSurface.scrollTop,
    scrollLeft: scrollSurface.scrollLeft,
    focused: item?.getAttribute("role") === "treeitem",
  });
}

function focus(item: HTMLElement | undefined, preventScroll = false): void {
  if (item === undefined) return;
  for (const row of items()) row.tabIndex = row === item ? 0 : -1;
  item.focus({ preventScroll: true });
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

document.addEventListener("keydown", (event) => {
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

// VS Code persists this state even when replacing the entire webview document.
const saved = readState();
if (tree !== null && saved !== undefined && saved.generation === tree.dataset.generation) {
  const restore = items().find((item) => item.dataset.nodeId === saved.focusId) ?? items()[0];
  if (saved.focused === true) focus(restore, true);
  else if (restore !== undefined) {
    for (const row of items()) row.tabIndex = row === restore ? 0 : -1;
  }
  if (scrollSurface !== null) {
    scrollSurface.scrollTop = typeof saved.scrollTop === "number" ? saved.scrollTop : 0;
    scrollSurface.scrollLeft = typeof saved.scrollLeft === "number" ? saved.scrollLeft : 0;
  }
} else if (tree !== null) {
  // A new symbol starts at its root without stealing focus from the editor.
  vscode.setState({ generation: tree.dataset.generation ?? "", focusId: "", scrollTop: 0, scrollLeft: 0 });
}
scrollSurface?.addEventListener("scroll", () => save(), { passive: true });
vscode.postMessage({ type: "ready" });
