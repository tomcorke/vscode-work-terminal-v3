import "./styles.css";

interface WorkTerminalViewState {
  readonly status: string;
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
  }
});

function applyState(nextState: WorkTerminalViewState): void {
  render(nextState);
  vscode.setState(nextState);
}

function render(nextState: WorkTerminalViewState): void {
  state = nextState;
  rootElement.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Work Terminal</p>
          <h1>VS Code port bootstrap</h1>
        </div>
        <button class="ghost-button" type="button" data-action="refresh">Refresh view</button>
      </header>

      <main class="layout">
        <section class="panel board-panel">
          <div class="panel-header">
            <h2>Board area</h2>
            <span class="pill">Next slice: work items</span>
          </div>
          <div class="placeholder-stack">
            <article class="card">
              <h3>Backlog lanes</h3>
              <p>Task columns and focus context will be rendered here.</p>
            </article>
            <article class="card">
              <h3>Selected item</h3>
              <p>Future work will attach actions, metadata, and selection state.</p>
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
    status: "Scaffold ready",
    workspaceName: "No workspace",
    lastUpdatedLabel: "Not yet updated",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
