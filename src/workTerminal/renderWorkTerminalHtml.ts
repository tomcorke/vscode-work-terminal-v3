export interface WorkTerminalViewState {
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
  readonly selectedItem: {
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
  } | null;
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

export interface RenderWorkTerminalHtmlOptions {
  readonly nonce: string;
  readonly scriptUri: string;
  readonly state: WorkTerminalViewState;
  readonly styleUri: string;
  readonly cspSource: string;
}

export function renderWorkTerminalHtml({
  cspSource,
  nonce,
  scriptUri,
  state,
  styleUri,
}: RenderWorkTerminalHtmlOptions): string {
  const bootstrapState = JSON.stringify(state)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Work Terminal</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body data-workspace-name="${escapeHtmlAttribute(state.workspaceName)}">
    <div id="work-terminal-root"></div>
    <script nonce="${nonce}">
      window.__WORK_TERMINAL_INITIAL_STATE__ = ${bootstrapState};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
