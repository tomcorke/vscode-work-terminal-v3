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
  readonly status: string;
  readonly storagePath: string | null;
  readonly totalWorkItems: number;
  readonly workspaceName: string;
  readonly lastUpdatedLabel: string;
}

type IncomingMessage = {
  readonly type: "state-updated";
  readonly payload: WorkTerminalViewState;
};

interface VsCodeApi<TState> {
  postMessage(message: unknown): void;
  getState(): TState | undefined;
  setState(state: TState): void;
}

declare const window: Window &
  typeof globalThis & {
    __WORK_TERMINAL_INITIAL_STATE__?: WorkTerminalViewState;
  };

declare function acquireVsCodeApi<TState>(): VsCodeApi<TState>;

const vscode = acquireVsCodeApi<WorkTerminalViewState>();
const root = document.querySelector<HTMLDivElement>("#work-terminal-root");

if (!root) {
  throw new Error("Work Terminal root was not found.");
}

const rootElement = root;

let state = vscode.getState() ?? window.__WORK_TERMINAL_INITIAL_STATE__ ?? createFallbackState();
let selectedItemId: string | null = state.boardColumns.flatMap((column) => column.items)[0]?.id ?? null;

render(state);
vscode.setState(state);
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

  const card = target.closest<HTMLElement>("[data-work-item-id]");
  if (card) {
    selectedItemId = card.dataset.workItemId ?? null;
    render(state);
  }
});

function applyState(nextState: WorkTerminalViewState): void {
  render(nextState);
  vscode.setState(nextState);
}

function render(nextState: WorkTerminalViewState): void {
  state = nextState;
  const selectedItem =
    nextState.boardColumns.flatMap((column) => column.items).find((item) => item.id === selectedItemId) ??
    nextState.boardColumns.flatMap((column) => column.items)[0] ??
    null;
  selectedItemId = selectedItem?.id ?? null;
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
                                    class="work-item-card${item.id === selectedItemId ? " is-selected" : ""}"
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
            </article>
          </div>
        </section>

        <section class="panel terminal-panel">
          <div class="panel-header">
            <h2>Terminal area</h2>
            <span class="pill">Next slice: sessions</span>
          </div>
          <div class="placeholder-stack">
            <article class="card">
              <h3>Session surface</h3>
              <p>Terminal tabs, launches, and output streams will appear here.</p>
            </article>
            <article class="card">
              <h3>Status</h3>
              <p>${escapeHtml(nextState.status)}</p>
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
    status: "Scaffold ready",
    storagePath: null,
    totalWorkItems: 0,
    workspaceName: "No workspace",
    lastUpdatedLabel: "Not yet updated",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
