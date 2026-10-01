declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>("button[data-node-id]");
  const viewNodeId = button?.dataset.nodeId;
  if (viewNodeId === undefined || viewNodeId.length === 0) {
    return;
  }
  sessionStorage.setItem("fullTypeViewer.focus", viewNodeId);
  vscode.postMessage({ type: "toggle", viewNodeId });
});

const restoreId = sessionStorage.getItem("fullTypeViewer.focus");
if (restoreId !== null) {
  sessionStorage.removeItem("fullTypeViewer.focus");
  document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(restoreId)}"]`)?.focus();
}
vscode.postMessage({ type: "ready" });
