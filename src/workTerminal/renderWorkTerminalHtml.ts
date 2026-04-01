export interface WorkTerminalViewState {
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
  const bootstrapState = JSON.stringify(state).replaceAll("<", "\\u003c");

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
