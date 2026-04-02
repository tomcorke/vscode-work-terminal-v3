import "./styles.css";

interface WorkTerminalViewState {
  readonly agentProfiles: ReadonlyArray<{
    readonly builtIn: boolean;
    readonly command: string;
    readonly id: string;
    readonly kind: "claude" | "copilot" | "custom" | "strands";
    readonly label: string;
    readonly resumeBehaviorLabel: string;
    readonly status: "invalid-configuration" | "missing-command" | "ready";
    readonly statusLabel: string;
    readonly usesContext: boolean;
  }>;
  readonly boardColumns: ReadonlyArray<{
    readonly id: string;
    readonly items: ReadonlyArray<{
      readonly blockerReason: string | null;
      readonly column: string;
      readonly completedAt: string | null;
      readonly createdAt: string;
      readonly description: string | null;
      readonly id: string;
      readonly isBlocked: boolean;
      readonly priorityDeadline: string | null;
      readonly priorityLevel: string;
      readonly priorityScore: number;
      readonly sourceCapturedAt: string | null;
      readonly sourceExternalId: string | null;
      readonly sourceKind: string;
      readonly sourcePath: string | null;
      readonly sourceUrl: string | null;
      readonly state: string;
      readonly title: string;
      readonly updatedAt: string;
    }>;
    readonly label: string;
  }>;
  readonly collapsedColumns: Record<string, boolean>;
  readonly columnSummaries: ReadonlyArray<{
    readonly count: number;
    readonly id: string;
    readonly label: string;
  }>;
  readonly latestWorkItemTitle: string | null;
  readonly profileIssues: ReadonlyArray<{
    readonly message: string;
    readonly profileId: string | null;
  }>;
  readonly selectedItemId: string | null;
  readonly recentlyClosedSessions: ReadonlyArray<{
    readonly closedAt: string;
    readonly command: string | null;
    readonly id: string;
    readonly itemDescription: string | null;
    readonly itemId: string;
    readonly itemTitle: string;
    readonly kind: "claude" | "copilot" | "custom" | "shell" | "strands";
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
    readonly kind: "claude" | "copilot" | "custom" | "shell" | "strands";
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

type BoardColumnId = "priority" | "todo" | "active" | "done";

type IncomingMessage = { readonly type: "state-updated"; readonly payload: WorkTerminalViewState };

interface VsCodeApi<TState> {
  postMessage(message: unknown): void;
  getState(): TState | undefined;
  setState(state: TState): void;
}

interface PersistedWebviewState {
  readonly filterQuery: string;
  readonly selectedItemId: string | null;
  readonly viewState: WorkTerminalViewState;
}

interface DragState {
  itemId: string;
  fromColumn: BoardColumnId;
}

interface FilterInputSnapshot {
  readonly selectionEnd: number | null;
  readonly selectionStart: number | null;
  readonly wasFocused: boolean;
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

let dragState: DragState | null = null;
let filterQuery = persistedState?.filterQuery ?? "";
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

  if (target.dataset.action === "manage-profiles") {
    vscode.postMessage({ type: "manage-profiles-requested" });
    return;
  }

  if (target.dataset.action === "edit-work-item-details") {
    const selectedItem = getActionableSelectedItem(state, filterQuery);
    if (selectedItem) {
      vscode.postMessage({ type: "edit-work-item-details-requested", itemId: selectedItem.id });
    }
    return;
  }

  if (target.dataset.action === "edit-work-item-metadata") {
    const selectedItem = getActionableSelectedItem(state, filterQuery);
    if (selectedItem) {
      vscode.postMessage({ type: "edit-work-item-metadata-requested", itemId: selectedItem.id });
    }
    return;
  }

  if (target.dataset.action === "move-work-item") {
    const selectedItem = getActionableSelectedItem(state, filterQuery);
    if (selectedItem) {
      vscode.postMessage({ type: "move-work-item-requested", itemId: selectedItem.id });
    }
    return;
  }

  if (target.dataset.action === "split-work-item") {
    const selectedItem = getActionableSelectedItem(state, filterQuery);
    if (selectedItem) {
      vscode.postMessage({ type: "split-work-item-requested", itemId: selectedItem.id });
    }
    return;
  }

  if (target.dataset.action === "open-work-item-source") {
    const selectedItem = getActionableSelectedItem(state, filterQuery);
    if (selectedItem) {
      vscode.postMessage({ type: "open-work-item-source-requested", itemId: selectedItem.id });
    }
    return;
  }

  if (target.dataset.action === "delete-work-item") {
    const selectedItem = getActionableSelectedItem(state, filterQuery);
    if (selectedItem) {
      vscode.postMessage({ type: "delete-work-item-requested", itemId: selectedItem.id });
    }
    return;
  }

  if (target.dataset.action === "more-work-item-actions") {
    const selectedItem = getActionableSelectedItem(state, filterQuery);
    if (selectedItem) {
      vscode.postMessage({ type: "more-work-item-actions-requested", itemId: selectedItem.id });
    }
    return;
  }

  if (target.dataset.action === "toggle-column-collapse") {
    const columnId = target.dataset.columnId;
    if (isBoardColumnId(columnId)) {
      vscode.postMessage({ type: "toggle-column-collapse-requested", columnId });
    }
    return;
  }

  if (target.dataset.action === "launch-shell") {
    const selectedItem = getActionableSelectedItem(state, filterQuery);
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
    const selectedItem = getActionableSelectedItem(state, filterQuery);
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

root.addEventListener("input", (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.action !== "filter-items") {
    return;
  }

  filterQuery = target.value;
  render(state);
  persistState();
});

root.addEventListener("dragstart", (event: DragEvent) => {
  if (filterQuery.trim().length > 0) {
    event.preventDefault();
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const card = target.closest<HTMLElement>("[data-work-item-id]");
  const columnId = card?.closest<HTMLElement>("[data-column-id]")?.dataset.columnId;
  const itemId = card?.dataset.workItemId;

  if (!card || !itemId || !isBoardColumnId(columnId)) {
    return;
  }

  dragState = { itemId, fromColumn: columnId };
  card.classList.add("is-dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", itemId);
  }
});

root.addEventListener("dragend", () => {
  clearDropTargets();
  dragState = null;
  document.querySelectorAll(".work-item-card.is-dragging").forEach((element) => {
    element.classList.remove("is-dragging");
  });
});

root.addEventListener("dragover", (event: DragEvent) => {
  if (!dragState || filterQuery.trim().length > 0) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const columnItems = target.closest<HTMLElement>(".board-column-items[data-column-id]");
  if (!columnItems) {
    return;
  }

  event.preventDefault();
  clearDropTargets();
  columnItems.classList.add("is-drop-target");
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
});

root.addEventListener("drop", (event: DragEvent) => {
  if (!dragState || filterQuery.trim().length > 0) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const columnItems = target.closest<HTMLElement>(".board-column-items[data-column-id]");
  const toColumn = columnItems?.dataset.columnId;
  if (!columnItems || !isBoardColumnId(toColumn)) {
    return;
  }

  event.preventDefault();
  const targetIndex = getDropIndex(event.clientY, columnItems, dragState.itemId);
  vscode.postMessage({
    type: "reorder-item-requested",
    fromColumn: dragState.fromColumn,
    itemId: dragState.itemId,
    targetIndex,
    toColumn,
  });
  clearDropTargets();
});

function applyState(nextState: WorkTerminalViewState): void {
  state = nextState;
  render(nextState);
  persistState();
}

function render(nextState: WorkTerminalViewState): void {
  state = nextState;
  const filterInputSnapshot = captureFilterInputSnapshot();
  const visibleBoardColumns = getVisibleBoardColumns(nextState, filterQuery);
  const visibleItems = visibleBoardColumns.flatMap((column) => column.items);
  const selectedItem = getActionableSelectedItem(nextState, filterQuery, visibleItems);
  const selectionHiddenByFilter =
    filterQuery.trim().length > 0 &&
    nextState.selectedItemId !== null &&
    !visibleItems.some((item) => item.id === nextState.selectedItemId);
  const selectedItemSessions = selectedItem
    ? nextState.terminalSessions.filter((session) => session.itemId === selectedItem.id)
    : [];
  const selectedItemRecentlyClosedSessions = selectedItem
    ? nextState.recentlyClosedSessions.filter((session) => session.itemId === selectedItem.id)
    : [];
  const dragEnabled = filterQuery.trim().length === 0;
  rootElement.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Work Terminal</p>
          <h1>VS Code port bootstrap</h1>
        </div>
        <div class="toolbar">
          <input
            class="filter-input"
            type="search"
            value="${escapeHtml(filterQuery)}"
            placeholder="Filter work items"
            aria-label="Filter work items"
            data-action="filter-items"
          />
          <button class="ghost-button" type="button" data-action="create">Create work item</button>
          <button class="ghost-button" type="button" data-action="manage-profiles">Manage profiles</button>
          <button class="ghost-button" type="button" data-action="refresh">Refresh view</button>
        </div>
      </header>

      <main class="layout">
        <section class="panel board-panel">
          <div class="panel-header">
            <h2>Board area</h2>
            <span class="pill">${nextState.totalWorkItems} persisted item${nextState.totalWorkItems === 1 ? "" : "s"}</span>
          </div>
          ${
            filterQuery.trim().length > 0
              ? `<p class="board-helper">Filtering by "${escapeHtml(filterQuery)}". Drag and drop is temporarily disabled while filtering.</p>`
              : `<p class="board-helper">Drag cards between columns to reorder or update their board state.</p>`
          }
          <div class="board-grid">
            ${visibleBoardColumns
              .map((column) => {
                const summaryCount = nextState.columnSummaries.find((summary) => summary.id === column.id)?.count ?? column.items.length;
                const isCollapsed = Boolean(nextState.collapsedColumns[column.id]);
                return `
                  <section class="board-column${isCollapsed ? " is-collapsed" : ""}" data-column-id="${escapeHtml(column.id)}">
                    <header class="board-column-header">
                      <div class="board-column-heading">
                        <h3>${escapeHtml(column.label)}</h3>
                        <span class="pill">${column.items.length}${filterQuery.trim().length > 0 ? ` / ${summaryCount}` : ""}</span>
                      </div>
                      <button
                        class="column-toggle"
                        type="button"
                        data-action="toggle-column-collapse"
                        data-column-id="${escapeHtml(column.id)}"
                        aria-label="${isCollapsed ? "Expand" : "Collapse"} ${escapeHtml(column.label)} column"
                        title="${isCollapsed ? "Expand" : "Collapse"} column"
                      >
                        ${isCollapsed ? "Show" : "Hide"}
                      </button>
                    </header>
                    <div class="board-column-items${dragEnabled ? " is-drag-enabled" : ""}" data-column-id="${escapeHtml(column.id)}">
                      ${
                        isCollapsed
                          ? '<p class="empty-column">Column collapsed.</p>'
                          : column.items.length > 0
                            ? column.items
                                .map(
                                  (item) => `
                                    <button
                                      class="work-item-card${item.id === nextState.selectedItemId ? " is-selected" : ""}"
                                      type="button"
                                      data-work-item-id="${escapeHtml(item.id)}"
                                      ${dragEnabled ? 'draggable="true"' : ""}
                                    >
                                       <span class="work-item-card-title">${escapeHtml(item.title)}</span>
                                       <span class="work-item-card-meta">
                                         ${escapeHtml(item.priorityLevel)} priority · score ${item.priorityScore} · ${escapeHtml(item.sourceKind)}
                                         ${item.sourceExternalId ? ` · ${escapeHtml(item.sourceExternalId)}` : ""}
                                         ${item.priorityDeadline ? ` · due ${escapeHtml(formatTimestamp(item.priorityDeadline))}` : ""}
                                         ${item.isBlocked ? " · blocked" : ""}
                                       </span>
                                     </button>
                                   `,
                                 )
                                 .join("")
                            : `<p class="empty-column">${filterQuery.trim().length > 0 ? "No matching items in this column." : "No items in this column yet."}</p>`
                      }
                    </div>
                  </section>
                `;
              })
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
              <p>${escapeHtml(
                selectionHiddenByFilter
                  ? "Current selection is hidden by the active filter."
                  : (selectedItem?.title ?? "No work items created yet."),
              )}</p>
              <p>${escapeHtml(
                selectionHiddenByFilter
                  ? "Clear the filter or select a visible work item to launch sessions."
                  : (selectedItem?.description ?? "Select a work item to review metadata, launch sessions, or run work-item actions."),
               )}</p>
               ${
                 selectedItem
                   ? `
                     <div class="detail-shell">
                       <div class="detail-header">
                         <div>
                           <strong class="detail-title">${escapeHtml(selectedItem.title)}</strong>
                           <p class="detail-subtitle">${escapeHtml(describeSelectedItemStatus(selectedItem))}</p>
                         </div>
                         <span class="pill">${nextState.terminalSessionCountByItemId[selectedItem.id] ?? 0} session${(nextState.terminalSessionCountByItemId[selectedItem.id] ?? 0) === 1 ? "" : "s"}</span>
                       </div>
                       <div class="detail-tag-row">
                         ${renderTag(selectedItem.priorityLevel, "priority")}
                         ${renderTag(`score ${selectedItem.priorityScore}`, "score")}
                         ${renderTag(selectedItem.sourceKind, "source")}
                         ${selectedItem.sourceExternalId ? renderTag(selectedItem.sourceExternalId, "source-ref") : ""}
                         ${selectedItem.isBlocked ? renderTag("blocked", "blocked") : ""}
                         ${selectedItem.priorityDeadline ? renderTag(`due ${formatTimestamp(selectedItem.priorityDeadline)}`, "deadline") : ""}
                       </div>
                       <dl class="detail-grid">
                         ${renderDetailRow("State", capitalize(selectedItem.state))}
                         ${renderDetailRow("Column", capitalize(selectedItem.column))}
                         ${renderDetailRow("Deadline", selectedItem.priorityDeadline ? formatTimestamp(selectedItem.priorityDeadline) : null)}
                         ${renderDetailRow("Blocked by", selectedItem.blockerReason)}
                         ${renderDetailRow("Source ref", selectedItem.sourceExternalId)}
                         ${renderDetailRow("Source URL", selectedItem.sourceUrl)}
                         ${renderDetailRow("Source path", selectedItem.sourcePath)}
                         ${renderDetailRow("Created", formatTimestamp(selectedItem.createdAt))}
                         ${renderDetailRow("Updated", formatTimestamp(selectedItem.updatedAt))}
                         ${renderDetailRow("Completed", selectedItem.completedAt ? formatTimestamp(selectedItem.completedAt) : null)}
                         ${renderDetailRow("Captured", selectedItem.sourceCapturedAt ? formatTimestamp(selectedItem.sourceCapturedAt) : null)}
                       </dl>
                       <div class="card-actions action-grid">
                         <button class="ghost-button" type="button" data-action="launch-shell">Open shell session</button>
                         <button class="ghost-button" type="button" data-action="edit-work-item-details">Edit details</button>
                         <button class="ghost-button" type="button" data-action="move-work-item">Move item</button>
                         <button class="ghost-button" type="button" data-action="split-work-item">Split task</button>
                         ${
                           selectedItem.sourceUrl || selectedItem.sourcePath
                             ? '<button class="ghost-button" type="button" data-action="open-work-item-source">Open source</button>'
                             : ""
                         }
                         <button class="ghost-button" type="button" data-action="more-work-item-actions">More actions</button>
                       </div>
                       <div class="card-actions action-grid">
                         <button class="ghost-button" type="button" data-action="edit-work-item-metadata">Edit metadata</button>
                         <button class="ghost-button danger-button" type="button" data-action="delete-work-item">Delete item</button>
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
                       </div>
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
              <div class="card-title-row">
                <h3>Agent launchers</h3>
                <button class="ghost-button" type="button" data-action="manage-profiles">Manage profiles</button>
              </div>
              <ul class="profile-list">
                ${nextState.agentProfiles
                  .map(
                    (profile) => `
                      <li class="profile-list-item">
                        <div>
                          <strong>${escapeHtml(profile.label)}</strong>
                          <p>${escapeHtml(`${capitalize(profile.kind)}${profile.usesContext ? " · ctx" : ""}${profile.builtIn ? " · built-in" : ""}`)}</p>
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
              <h3>Profile diagnostics</h3>
              ${nextState.profileIssues.length > 0
                ? `<ul class="profile-issue-list">${nextState.profileIssues
                  .map((issue) => `<li>${escapeHtml(issue.profileId ? `${issue.profileId}: ${issue.message}` : issue.message)}</li>`)
                  .join("")}</ul>`
                : "<p>No profile configuration issues detected.</p>"}
              <p class="session-meta">Fix issues in Manage Profiles or directly in the workTerminal.agentProfiles setting.</p>
            </article>
            <article class="card">
              <h3>Host-managed sessions</h3>
              <p>${escapeHtml(nextState.status)}</p>
              <p>Shell, Claude, Copilot, Strands, and custom sessions opened from the board are tracked here by work item.</p>
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
  restoreFilterInputSnapshot(filterInputSnapshot);
}

function getSelectedItem(nextState: WorkTerminalViewState): WorkTerminalViewState["boardColumns"][number]["items"][number] | null {
  return (
    nextState.boardColumns.flatMap((column) => column.items).find((item) => item.id === nextState.selectedItemId) ??
    nextState.boardColumns.flatMap((column) => column.items)[0] ??
    null
  );
}

function getActionableSelectedItem(
  nextState: WorkTerminalViewState,
  query: string,
  visibleItems: WorkTerminalViewState["boardColumns"][number]["items"] | null = null,
): WorkTerminalViewState["boardColumns"][number]["items"][number] | null {
  if (query.trim().length === 0) {
    return getSelectedItem(nextState);
  }

  const actionableItems = visibleItems ?? getVisibleBoardColumns(nextState, query).flatMap((column) => column.items);
  return actionableItems.find((item) => item.id === nextState.selectedItemId) ?? null;
}

function captureFilterInputSnapshot(): FilterInputSnapshot {
  const input = rootElement.querySelector<HTMLInputElement>('input[data-action="filter-items"]');
  return {
    selectionEnd: input?.selectionEnd ?? null,
    selectionStart: input?.selectionStart ?? null,
    wasFocused: document.activeElement === input,
  };
}

function restoreFilterInputSnapshot(snapshot: FilterInputSnapshot): void {
  if (!snapshot.wasFocused) {
    return;
  }

  const input = rootElement.querySelector<HTMLInputElement>('input[data-action="filter-items"]');
  input?.focus();
  if (input && snapshot.selectionStart != null && snapshot.selectionEnd != null) {
    input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

function createFallbackState(): WorkTerminalViewState {
  return {
    agentProfiles: [],
    boardColumns: [],
    collapsedColumns: {
      priority: false,
      todo: false,
      active: false,
      done: false,
    },
    columnSummaries: [],
    latestWorkItemTitle: null,
    profileIssues: [],
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
    filterQuery,
    selectedItemId: state.selectedItemId,
    viewState: state,
  });
}

function describeSession(session: WorkTerminalViewState["terminalSessions"][number]): string {
  return describeSessionDetails(session);
}

function describeSelectedItemStatus(
  item: WorkTerminalViewState["boardColumns"][number]["items"][number],
): string {
  const details = [`${capitalize(item.column)} column`, `${capitalize(item.state)} state`];
  if (item.priorityDeadline) {
    details.push(`due ${formatTimestamp(item.priorityDeadline)}`);
  }
  if (item.isBlocked) {
    details.push("blocked");
  }
  return details.join(" · ");
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

function formatTimestamp(value: string): string {
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

function getVisibleBoardColumns(nextState: WorkTerminalViewState, query: string): WorkTerminalViewState["boardColumns"] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return nextState.boardColumns;
  }

  return nextState.boardColumns.map((column) => ({
    ...column,
    items: column.items.filter((item) => {
      const haystacks = [
        item.title,
        item.description ?? "",
        item.priorityLevel,
        item.sourceKind,
        item.blockerReason ?? "",
        item.priorityDeadline ?? "",
        item.sourceExternalId ?? "",
        item.sourceUrl ?? "",
        item.sourcePath ?? "",
        item.state,
      ];
      return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
    }),
  }));
}

function getDropIndex(clientY: number, container: HTMLElement, draggedItemId: string): number {
  const cards = Array.from(container.querySelectorAll<HTMLElement>(".work-item-card[data-work-item-id]"))
    .filter((element) => element.dataset.workItemId !== draggedItemId);

  for (const [index, card] of cards.entries()) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return index;
    }
  }

  return cards.length;
}

function clearDropTargets(): void {
  document.querySelectorAll(".board-column-items.is-drop-target").forEach((element) => {
    element.classList.remove("is-drop-target");
  });
}

function isBoardColumnId(value: string | undefined): value is BoardColumnId {
  return value === "priority" || value === "todo" || value === "active" || value === "done";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderTag(value: string, tone: "blocked" | "deadline" | "priority" | "score" | "source" | "source-ref"): string {
  return `<span class="detail-tag detail-tag-${tone}">${escapeHtml(value)}</span>`;
}

function renderDetailRow(label: string, value: string | null): string {
  return `
    <div class="detail-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value ?? "Not set")}</dd>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
