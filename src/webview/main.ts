import "./styles.css";

interface WorkTerminalViewState {
  readonly boardColumns: ReadonlyArray<{
    readonly id: string;
    readonly items: ReadonlyArray<{
      readonly description: string | null;
      readonly id: string;
      readonly isBlocked: boolean;
      readonly priorityLevel: string;
      readonly sourceKind: string;
      readonly title: string;
      readonly updatedAt: string;
    }>;
    readonly label: string;
  }>;
  readonly columnSummaries: ReadonlyArray<{
    readonly count: number;
    readonly id: string;
    readonly label: string;
  }>;
  readonly latestWorkItemTitle: string | null;
  readonly selectedItemId: string | null;
  readonly status: string;
  readonly storagePath: string | null;
  readonly terminalSessionCountByItemId: Record<string, number>;
  readonly terminalSessions: ReadonlyArray<{
    readonly id: string;
    readonly itemId: string;
    readonly itemTitle: string;
    readonly kind: "shell";
    readonly label: string;
  }>;
  readonly totalWorkItems: number;
  readonly workspaceName: string;
  readonly lastUpdatedLabel: string;
}

type IncomingMessage = { readonly type: "state-updated"; readonly payload: WorkTerminalViewState };

interface VsCodeApi<TState> {
  postMessage(message: unknown): void;
  getState(): TState | undefined;
  setState(state: TState): void;
}

interface PersistedWebviewState {
  readonly selectedItemId: string | null;
  readonly viewState: WorkTerminalViewState;
}

declare const window: Window &
  typeof globalThis & {
    __WORK_TERMINAL_INITIAL_STATE__?: WorkTerminalViewState;
  };

declare function acquireVsCodeApi<TState>(): VsCodeApi<TState>;

const vscode = acquireVsCodeApi<PersistedWebviewState>();
const root = document.querySelector<HTMLDivElement>("#work-terminal-root");

if (!root) {
  throw new Error("Work Terminal root was not found.");
}

const rootElement = root;
const persistedState = vscode.getState();

let state = persistedState?.viewState ?? window.__WORK_TERMINAL_INITIAL_STATE__ ?? createFallbackState();

render(state);
persistState();
vscode.postMessage({ type: "ready" });

window.addEventListener("message", (event: MessageEvent<IncomingMessage>) => {
  if (event.data.type === "state-updated") {
    applyState(event.data.payload);
  }
});

root.addEventListener("click", (event: MouseEvent) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.dataset.action === "refresh") {
    vscode.postMessage({ type: "refresh-requested" });
    applyState({
      ...state,
      status: "Refreshing placeholder state from extension host...",
    });
    return;
  }

  if (target.dataset.action === "create") {
    vscode.postMessage({ type: "create-work-item-requested" });
    return;
  }

  if (target.dataset.action === "launch-shell") {
    if (!state.selectedItemId) {
      return;
    }

    const selectedItem = state.boardColumns
      .flatMap((column) => column.items)
      .find((item) => item.id === state.selectedItemId);

    if (selectedItem) {
      vscode.postMessage({
        type: "launch-shell-requested",
        itemId: selectedItem.id,
        itemTitle: selectedItem.title,
      });
    }
    return;
  }

  if (target.dataset.action === "focus-terminal") {
    const terminalId = target.dataset.terminalId;
    if (terminalId) {
      vscode.postMessage({ type: "focus-terminal-requested", terminalId });
    }
    return;
  }

  const card = target.closest<HTMLElement>("[data-work-item-id]");
  if (card) {
    const itemId = card.dataset.workItemId ?? null;
    applyState({ ...state, selectedItemId: itemId });
    vscode.postMessage({ type: "work-item-selected", itemId });
  }
});

function applyState(nextState: WorkTerminalViewState): void {
  render(nextState);
  persistState();
}

function render(nextState: WorkTerminalViewState): void {
  state = nextState;
  const selectedItem =
    nextState.boardColumns.flatMap((column) => column.items).find((item) => item.id === nextState.selectedItemId) ??
    nextState.boardColumns.flatMap((column) => column.items)[0] ??
    null;
  const selectedItemSessions = selectedItem
    ? nextState.terminalSessions.filter((session) => session.itemId === selectedItem.id)
    : [];
  rootElement.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Work Terminal</p>
          <h1>VS Code port bootstrap</h1>
        </div>
        <div class="toolbar">
          <button class="ghost-button" type="button" data-action="create">Create work item</button>
          <button class="ghost-button" type="button" data-action="refresh">Refresh view</button>
        </div>
      </header>

      <main class="layout">
        <section class="panel board-panel">
          <div class="panel-header">
            <h2>Board area</h2>
            <span class="pill">${nextState.totalWorkItems} persisted item${nextState.totalWorkItems === 1 ? "" : "s"}</span>
          </div>
          <div class="board-grid">
            ${nextState.boardColumns
              .map(
                (column) => `
                  <section class="board-column">
                    <header class="board-column-header">
                      <h3>${escapeHtml(column.label)}</h3>
                      <span class="pill">${column.items.length}</span>
                    </header>
                    <div class="board-column-items">
                      ${
                        column.items.length > 0
                          ? column.items
                              .map(
                                (item) => `
                                  <button
                                    class="work-item-card${item.id === nextState.selectedItemId ? " is-selected" : ""}"
                                    type="button"
                                    data-work-item-id="${escapeHtml(item.id)}"
                                  >
                                    <span class="work-item-card-title">${escapeHtml(item.title)}</span>
                                    <span class="work-item-card-meta">
                                      ${escapeHtml(item.priorityLevel)} priority · ${escapeHtml(item.sourceKind)}
                                      ${item.isBlocked ? " · blocked" : ""}
                                    </span>
                                  </button>
                                `,
                              )
                              .join("")
                          : '<p class="empty-column">No items in this column yet.</p>'
                      }
                    </div>
                  </section>
                `,
              )
              .join("")}
          </div>
          <div class="placeholder-stack">
            <article class="card">
              <h3>Persisted work items</h3>
              <p>${escapeHtml(
                nextState.storagePath
                  ? `${nextState.totalWorkItems} items stored in ${nextState.storagePath}`
                  : "Open a workspace to start persisting work items.",
              )}</p>
              <ul class="summary-list">
                ${nextState.columnSummaries
                  .map(
                    (summary) =>
                      `<li><span>${escapeHtml(summary.label)}</span><strong>${summary.count}</strong></li>`,
                  )
                  .join("")}
              </ul>
            </article>
            <article class="card">
              <h3>Selected item</h3>
              <p>${escapeHtml(selectedItem?.title ?? "No work items created yet.")}</p>
              <p>${escapeHtml(selectedItem?.description ?? "Selection currently lives in the webview. Host-backed actions come next.")}</p>
              ${
                selectedItem
                  ? `<div class="card-actions">
                      <button class="ghost-button" type="button" data-action="launch-shell">Open shell session</button>
                      <span class="pill">${nextState.terminalSessionCountByItemId[selectedItem.id] ?? 0} session${(nextState.terminalSessionCountByItemId[selectedItem.id] ?? 0) === 1 ? "" : "s"}</span>
                    </div>`
                  : ""
              }
            </article>
          </div>
        </section>

        <section class="panel terminal-panel">
          <div class="panel-header">
            <h2>Terminal area</h2>
            <span class="pill">${nextState.terminalSessions.length} open session${nextState.terminalSessions.length === 1 ? "" : "s"}</span>
          </div>
          <div class="placeholder-stack">
            <article class="card">
              <h3>Shell sessions</h3>
              ${
                selectedItem
                  ? selectedItemSessions.length > 0
                    ? `<ul class="session-list">
                        ${selectedItemSessions
                          .map(
                            (session) => `
                              <li class="session-list-item">
                                <div>
                                  <strong>${escapeHtml(session.label)}</strong>
                                  <p>${escapeHtml(session.itemTitle)}</p>
                                </div>
                                <button
                                  class="ghost-button"
                                  type="button"
                                  data-action="focus-terminal"
                                  data-terminal-id="${escapeHtml(session.id)}"
                                >
                                  Focus terminal
                                </button>
                              </li>
                            `,
                          )
                          .join("")}
                      </ul>`
                    : `<p>No shell sessions are open for "${escapeHtml(selectedItem.title)}" yet.</p>`
                  : "<p>Select a work item to manage its shell sessions.</p>"
              }
            </article>
            <article class="card">
              <h3>Host-managed sessions</h3>
              <p>${escapeHtml(nextState.status)}</p>
              <p>Shell sessions currently open in VS Code's terminal panel are tracked here by work item.</p>
            </article>
          </div>
        </section>
      </main>

      <footer class="footer">
        <span>Workspace: ${escapeHtml(nextState.workspaceName)}</span>
        <span>Updated: ${escapeHtml(nextState.lastUpdatedLabel)}</span>
      </footer>
    </div>
  `;
}

function createFallbackState(): WorkTerminalViewState {
  return {
    boardColumns: [],
    columnSummaries: [],
    latestWorkItemTitle: null,
    selectedItemId: null,
    status: "Scaffold ready",
    storagePath: null,
    terminalSessionCountByItemId: {},
    terminalSessions: [],
    totalWorkItems: 0,
    workspaceName: "No workspace",
    lastUpdatedLabel: "Not yet updated",
  };
}

function persistState(): void {
  vscode.setState({
    selectedItemId: state.selectedItemId,
    viewState: state,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
