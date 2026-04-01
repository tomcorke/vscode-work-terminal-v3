import "./styles.css";

interface WorkTerminalViewState {
  readonly agentProfiles: ReadonlyArray<{
    readonly command: string;
    readonly id: string;
    readonly kind: "claude" | "copilot";
    readonly label: string;
    readonly resumeBehaviorLabel: string;
    readonly status: "missing-command" | "ready";
    readonly statusLabel: string;
    readonly usesContext: boolean;
  }>;
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
  readonly recentlyClosedSessions: ReadonlyArray<{
    readonly closedAt: string;
    readonly command: string | null;
    readonly id: string;
    readonly itemDescription: string | null;
    readonly itemId: string;
    readonly itemTitle: string;
    readonly kind: "claude" | "copilot" | "shell";
    readonly label: string;
    readonly profileId: string | null;
    readonly profileLabel: string | null;
    readonly resumeSessionId: string | null;
    readonly statusLabel: string;
  }>;
  readonly status: string;
  readonly storagePath: string | null;
  readonly terminalSessionCountByItemId: Record<string, number>;
  readonly terminalSessions: ReadonlyArray<{
    readonly activityState: "active" | "idle" | "waiting" | null;
    readonly activityStateLabel: string | null;
    readonly command: string | null;
    readonly id: string;
    readonly itemDescription: string | null;
    readonly itemId: string;
    readonly itemTitle: string;
    readonly kind: "claude" | "copilot" | "shell";
    readonly label: string;
    readonly profileId: string | null;
    readonly profileLabel: string | null;
    readonly resumeSessionId: string | null;
    readonly statusLabel: string;
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
vscode.postMessage({ type: "ready", selectedItemId: state.selectedItemId });

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
    const selectedItem = getSelectedItem(state);
    if (!selectedItem) {
      return;
    }

    vscode.postMessage({
      type: "launch-shell-requested",
      itemDescription: selectedItem.description,
      itemId: selectedItem.id,
      itemTitle: selectedItem.title,
    });
    return;
  }

  if (target.dataset.action === "launch-agent") {
    const selectedItem = getSelectedItem(state);
    const profileId = target.dataset.profileId;
    if (!selectedItem || !profileId) {
      return;
    }

    vscode.postMessage({
      type: "launch-agent-requested",
      itemDescription: selectedItem.description,
      itemId: selectedItem.id,
      itemTitle: selectedItem.title,
      profileId,
    });
    return;
  }

  if (target.dataset.action === "focus-terminal") {
    const terminalId = target.dataset.terminalId;
    if (terminalId) {
      vscode.postMessage({ type: "focus-terminal-requested", terminalId });
    }
    return;
  }

  if (target.dataset.action === "reopen-recent-session") {
    const sessionId = target.dataset.sessionId;
    if (sessionId) {
      vscode.postMessage({ type: "reopen-recent-session-requested", sessionId });
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
  const selectedItem = getSelectedItem(nextState);
  const selectedItemSessions = selectedItem
    ? nextState.terminalSessions.filter((session) => session.itemId === selectedItem.id)
    : [];
  const selectedItemRecentlyClosedSessions = selectedItem
    ? nextState.recentlyClosedSessions.filter((session) => session.itemId === selectedItem.id)
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
              <p>${escapeHtml(
                selectedItem?.description ?? "Select a work item to launch shell or agent sessions.",
              )}</p>
              ${
                selectedItem
                  ? `<div class="card-actions action-grid">
                      <button class="ghost-button" type="button" data-action="launch-shell">Open shell session</button>
                      ${nextState.agentProfiles
                        .map(
                          (profile) => `
                            <button
                              class="ghost-button"
                              type="button"
                              data-action="launch-agent"
                              data-profile-id="${escapeHtml(profile.id)}"
                              ${profile.status !== "ready" ? "disabled" : ""}
                              title="${escapeHtml(profile.statusLabel)}"
                            >
                              ${escapeHtml(profile.label)}
                            </button>
                          `,
                        )
                        .join("")}
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
              <h3>Agent launchers</h3>
              <ul class="profile-list">
                ${nextState.agentProfiles
                  .map(
                    (profile) => `
                      <li class="profile-list-item">
                        <div>
                          <strong>${escapeHtml(profile.label)}</strong>
                          <p>${escapeHtml(profile.resumeBehaviorLabel)}</p>
                        </div>
                        <div class="profile-status ${profile.status === "ready" ? "is-ready" : "is-missing"}">${escapeHtml(profile.statusLabel)}</div>
                      </li>
                    `,
                  )
                  .join("")}
              </ul>
            </article>
            <article class="card">
              <h3>Sessions for selected item</h3>
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
                                  ${
                                    session.activityState && session.activityStateLabel
                                      ? `<p class="session-meta">${escapeHtml(`${formatActivityState(session.activityState)} · ${session.activityStateLabel}`)}</p>`
                                      : ""
                                  }
                                  <p>${escapeHtml(session.statusLabel)}</p>
                                  <p class="session-meta">${escapeHtml(describeSession(session))}</p>
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
                    : `<p>No sessions are open for "${escapeHtml(selectedItem.title)}" yet.</p>`
                  : "<p>Select a work item to manage its sessions.</p>"
              }
            </article>
            <article class="card">
              <h3>Recently closed for selected item</h3>
              ${
                selectedItem
                  ? selectedItemRecentlyClosedSessions.length > 0
                    ? `<ul class="session-list">
                        ${selectedItemRecentlyClosedSessions
                          .map(
                            (session) => `
                              <li class="session-list-item">
                                <div>
                                  <strong>${escapeHtml(session.label)}</strong>
                                  <p>${escapeHtml(session.statusLabel)}</p>
                                  <p class="session-meta">${escapeHtml(`${describeSessionDetails(session)} · closed ${formatClosedAt(session.closedAt)}`)}</p>
                                </div>
                                <button
                                  class="ghost-button"
                                  type="button"
                                  data-action="reopen-recent-session"
                                  data-session-id="${escapeHtml(session.id)}"
                                >
                                  Reopen session
                                </button>
                              </li>
                            `,
                          )
                          .join("")}
                      </ul>`
                    : `<p>No recently closed sessions are available for "${escapeHtml(selectedItem.title)}".</p>`
                  : "<p>Select a work item to reopen its recently closed sessions.</p>"
              }
            </article>
            <article class="card">
              <h3>Host-managed sessions</h3>
              <p>${escapeHtml(nextState.status)}</p>
              <p>Shell, Claude, and Copilot sessions opened from the board are tracked here by work item.</p>
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

function getSelectedItem(nextState: WorkTerminalViewState): WorkTerminalViewState["boardColumns"][number]["items"][number] | null {
  return (
    nextState.boardColumns.flatMap((column) => column.items).find((item) => item.id === nextState.selectedItemId) ??
    nextState.boardColumns.flatMap((column) => column.items)[0] ??
    null
  );
}

function createFallbackState(): WorkTerminalViewState {
  return {
    agentProfiles: [],
    boardColumns: [],
    columnSummaries: [],
    latestWorkItemTitle: null,
    recentlyClosedSessions: [],
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

function describeSession(session: WorkTerminalViewState["terminalSessions"][number]): string {
  return describeSessionDetails(session);
}

function describeSessionDetails(
  session:
    | WorkTerminalViewState["terminalSessions"][number]
    | WorkTerminalViewState["recentlyClosedSessions"][number],
): string {
  const details = [session.profileLabel ?? capitalize(session.kind)];

  if (session.resumeSessionId) {
    details.push(`resume id ${session.resumeSessionId}`);
  }

  if (session.command) {
    details.push(`cmd: ${session.command}`);
  }

  return details.join(" · ");
}

function formatClosedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
}

function formatActivityState(value: "active" | "idle" | "waiting"): string {
  switch (value) {
    case "active":
      return "Active";
    case "idle":
      return "Idle";
    case "waiting":
      return "Waiting";
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
