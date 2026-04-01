import * as vscode from "vscode";

import type { AgentProfileId } from "../agents";
import type { TerminalSessionStore } from "../terminals";
import type { WorkItemStore } from "../workItems";
import { getNonce } from "./getNonce";
import {
  renderWorkTerminalHtml,
  type WorkTerminalViewState,
} from "./renderWorkTerminalHtml";

type WorkTerminalWebviewMessage =
  | { readonly type: "ready"; readonly selectedItemId: string | null }
  | { readonly type: "create-work-item-requested" }
  | { readonly type: "focus-terminal-requested"; readonly terminalId: string }
  | {
      readonly type: "launch-agent-requested";
      readonly itemDescription: string | null;
      readonly itemId: string;
      readonly itemTitle: string;
      readonly profileId: AgentProfileId;
    }
  | {
      readonly type: "launch-shell-requested";
      readonly itemDescription: string | null;
      readonly itemId: string;
      readonly itemTitle: string;
    }
  | { readonly type: "work-item-selected"; readonly itemId: string | null }
  | { readonly type: "refresh-requested" };

export class WorkTerminalViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "workTerminal.view";

  private lastStatus = "Work Terminal ready";
  private selectedItemId: string | null = null;
  private view: vscode.WebviewView | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly disposables: vscode.Disposable[],
    private readonly store: WorkItemStore,
    private readonly terminalStore: TerminalSessionStore,
  ) {
    this.disposables.push(
      this.terminalStore.onDidChangeSessions(() => {
        void this.refresh("Updated terminal session state");
      }),
    );
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js"),
    );
    const styleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.css"),
    );
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
    webviewView.webview.html = renderWorkTerminalHtml({
      cspSource: webviewView.webview.cspSource,
      nonce: getNonce(),
      scriptUri: scriptUri.toString(),
      state: await this.createViewState(this.lastStatus),
      styleUri: styleUri.toString(),
    });

    webviewView.webview.onDidReceiveMessage(
      async (message: WorkTerminalWebviewMessage) => {
        if (message.type === "ready") {
          this.selectedItemId = message.selectedItemId;
          await this.postState("Work Terminal view connected");
          return;
        }

        if (message.type === "refresh-requested") {
          await this.refresh();
          return;
        }

        if (message.type === "create-work-item-requested") {
          await this.createWorkItemFromPrompt();
          return;
        }

        if (message.type === "work-item-selected") {
          this.selectedItemId = message.itemId;
          await this.postState(this.lastStatus);
          return;
        }

        if (message.type === "launch-shell-requested") {
          await this.launchShell(message.itemId, message.itemTitle, message.itemDescription);
          return;
        }

        if (message.type === "launch-agent-requested") {
          await this.launchAgent(
            message.profileId,
            message.itemId,
            message.itemTitle,
            message.itemDescription,
          );
          return;
        }

        if (message.type === "focus-terminal-requested") {
          this.focusTerminal(message.terminalId);
        }
      },
      undefined,
      this.disposables,
    );
  }

  public reveal(): void {
    this.view?.show?.(true);
  }

  public async refresh(status = "Refreshed work item state from extension host"): Promise<void> {
    this.lastStatus = status;
    await this.postState(status);
  }

  public async createWorkItemFromPrompt(): Promise<void> {
    const title = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Create a work item",
      placeHolder: "Investigate task sync bug",
      validateInput: (value) => (value.trim().length > 0 ? null : "A title is required."),
    });

    if (!title) {
      return;
    }

    const state = await promptForState();
    if (!state) {
      return;
    }

    const item = await this.store.createWorkItem({ title, state });

    if (!item) {
      void vscode.window.showWarningMessage("Work Terminal needs an open workspace to persist work items.");
      return;
    }

    await this.refresh(`Created "${item.title}"`);
    void vscode.window.showInformationMessage(`Created work item "${item.title}".`);
  }

  public async launchShell(itemId: string, itemTitle: string, itemDescription: string | null): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const session = await this.terminalStore.createShellSession(itemId, itemTitle, itemDescription, cwd);

    await this.refresh(`Opened shell session "${session.label}"`);
  }

  public async launchAgent(
    profileId: AgentProfileId,
    itemId: string,
    itemTitle: string,
    itemDescription: string | null,
  ): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const result = await this.terminalStore.createAgentSession({
      cwd,
      itemDescription,
      itemId,
      itemTitle,
      profileId,
    });

    if (!result.session) {
      void vscode.window.showWarningMessage(result.error ?? "Unable to launch that agent session.");
      return;
    }

    await this.refresh(`Opened ${result.session.profileLabel ?? result.session.kind} session "${result.session.label}"`);
  }

  public focusTerminal(terminalId: string): void {
    const focused = this.terminalStore.focusSession(terminalId);

    if (!focused) {
      void vscode.window.showWarningMessage("That terminal session is no longer open.");
    }
  }

  private async postState(status: string): Promise<void> {
    const state = await this.createViewState(status);

    await this.view?.webview.postMessage({
      type: "state-updated",
      payload: state,
    });
  }

  private async createViewState(status: string): Promise<WorkTerminalViewState> {
    const summary = await this.store.getSummary();
    const allItems = summary.boardColumns.flatMap((column) => column.items);
    const resolvedSelectedItemId = allItems.some((item) => item.id === this.selectedItemId)
      ? this.selectedItemId
      : allItems[0]?.id ?? null;
    this.selectedItemId = resolvedSelectedItemId;
    const terminalSummary = this.terminalStore.getSummary();

    return {
      agentProfiles: terminalSummary.agentProfiles,
      boardColumns: summary.boardColumns,
      columnSummaries: summary.columnSummaries,
      latestWorkItemTitle: summary.latestWorkItemTitle,
      selectedItemId: resolvedSelectedItemId,
      status,
      storagePath: summary.storagePath,
      terminalSessionCountByItemId: terminalSummary.sessionCountByItemId,
      terminalSessions: terminalSummary.sessions,
      totalWorkItems: summary.totalCount,
      workspaceName:
        vscode.workspace.name ??
        vscode.workspace.workspaceFolders?.[0]?.name ??
        "No workspace",
      lastUpdatedLabel: new Date().toLocaleTimeString(),
    };
  }
}

async function promptForState(): Promise<"priority" | "todo" | "active" | "done" | undefined> {
  const choices = [
    { label: "To Do", state: "todo" },
    { label: "Active", state: "active" },
    { label: "Priority", state: "priority" },
    { label: "Done", state: "done" },
  ] as const;

  const selection = await vscode.window.showQuickPick(choices, {
    ignoreFocusOut: true,
    placeHolder: "Choose the initial state",
  });

  return selection?.state;
}
