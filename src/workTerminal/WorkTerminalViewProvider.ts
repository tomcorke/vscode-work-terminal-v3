import * as vscode from "vscode";

import {
  AGENT_PROFILES_CONFIGURATION_KEY,
  getBuiltInAgentProfileById,
  loadAgentProfileCatalog,
  serializeAgentProfiles,
  type AgentKind,
  type AgentProfile,
  type AgentProfileId,
} from "../agents";
import { resolveConfiguredWorkingDirectory } from "../terminals/TerminalLaunchConfiguration";
import type { TerminalSessionStore } from "../terminals";
import type {
  WorkItem,
  WorkItemColumn,
  WorkItemColumnDefinition,
  WorkItemPriorityLevel,
  WorkItemSourceKind,
  WorkItemWorkflowStore,
} from "../workItems";
import { getNonce } from "./getNonce";
import {
  renderWorkTerminalHtml,
  type WorkTerminalViewState,
} from "./renderWorkTerminalHtml";

type WorkTerminalWebviewMessage =
  | { readonly type: "ready"; readonly selectedItemId: string | null }
  | { readonly type: "create-work-item-requested" }
  | { readonly type: "delete-work-item-requested"; readonly itemId: string }
  | { readonly type: "edit-work-item-details-requested"; readonly itemId: string }
  | { readonly type: "edit-work-item-metadata-requested"; readonly itemId: string }
  | { readonly type: "focus-terminal-requested"; readonly terminalId: string }
  | { readonly type: "manage-profiles-requested" }
  | { readonly type: "open-settings-requested" }
  | { readonly type: "more-work-item-actions-requested"; readonly itemId: string }
  | { readonly type: "move-work-item-requested"; readonly itemId: string }
  | { readonly type: "open-work-item-source-requested"; readonly itemId: string }
  | {
      readonly type: "reorder-item-requested";
      readonly fromColumn: "priority" | "todo" | "active" | "done";
      readonly itemId: string;
      readonly targetIndex: number;
      readonly toColumn: "priority" | "todo" | "active" | "done";
    }
    | { readonly type: "reopen-recent-session-requested"; readonly sessionId: string }
  | { readonly type: "split-work-item-requested"; readonly itemId: string }
  | { readonly type: "toggle-column-collapse-requested"; readonly columnId: "priority" | "todo" | "active" | "done" }
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
    private readonly store: WorkItemWorkflowStore,
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

        if (message.type === "manage-profiles-requested") {
          await this.manageProfilesFromPrompt();
          return;
        }

        if (message.type === "open-settings-requested") {
          await this.openSettings();
          return;
        }

        if (message.type === "edit-work-item-details-requested") {
          await this.editWorkItemDetails(message.itemId);
          return;
        }

        if (message.type === "edit-work-item-metadata-requested") {
          await this.editWorkItemMetadata(message.itemId);
          return;
        }

        if (message.type === "move-work-item-requested") {
          await this.moveWorkItem(message.itemId);
          return;
        }

        if (message.type === "split-work-item-requested") {
          await this.splitWorkItemFromPrompt(message.itemId);
          return;
        }

        if (message.type === "open-work-item-source-requested") {
          await this.openWorkItemSource(message.itemId);
          return;
        }

        if (message.type === "delete-work-item-requested") {
          await this.deleteWorkItemFromPrompt(message.itemId);
          return;
        }

        if (message.type === "more-work-item-actions-requested") {
          await this.showMoreActionsForItem(message.itemId);
          return;
        }

        if (message.type === "work-item-selected") {
          this.selectedItemId = message.itemId;
          await this.postState(this.lastStatus);
          return;
        }

        if (message.type === "reorder-item-requested") {
          const reordered = await this.store.reorderItems(
            message.itemId,
            message.fromColumn,
            message.toColumn,
            message.targetIndex,
          );

          if (!reordered) {
            void vscode.window.showWarningMessage("That work item could not be reordered.");
            return;
          }

          await this.refresh("Reordered work items");
          return;
        }

        if (message.type === "toggle-column-collapse-requested") {
          const toggled = await this.store.toggleColumnCollapsed(message.columnId);
          if (!toggled) {
            void vscode.window.showWarningMessage("That column could not be updated.");
            return;
          }

          await this.refresh("Updated board layout");
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
          return;
        }

        if (message.type === "reopen-recent-session-requested") {
          await this.reopenRecentlyClosedSession(message.sessionId);
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

    const state = await promptForState(this.store.getColumnDefinitions());
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

  public async editWorkItemDetails(itemId: string): Promise<void> {
    const item = await this.getStoredWorkItemOrWarn(itemId);
    if (!item) {
      return;
    }

    const title = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Edit work item title",
      placeHolder: "Investigate task sync bug",
      value: item.title,
      validateInput: (value) => (value.trim().length > 0 ? null : "A title is required."),
    });

    if (title === undefined) {
      return;
    }

    const description = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Edit work item description",
      placeHolder: "Optional details for the selected work item",
      value: item.description ?? "",
    });

    if (description === undefined) {
      return;
    }

    const updated = await this.store.updateWorkItem(itemId, {
      description,
      title,
    });

    if (!updated) {
      void vscode.window.showWarningMessage("That work item could not be updated.");
      return;
    }

    await this.refresh(`Updated "${updated.title}"`);
  }

  public async editWorkItemMetadata(itemId: string): Promise<void> {
    const item = await this.getStoredWorkItemOrWarn(itemId);
    if (!item) {
      return;
    }

    const priorityLevel = await promptForPriorityLevel(item.priority.level);
    if (!priorityLevel) {
      return;
    }

    const priorityScoreValue = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Priority score",
      placeHolder: "0-100",
      value: String(item.priority.score),
      validateInput: validatePriorityScoreInput,
    });
    if (priorityScoreValue === undefined) {
      return;
    }

    const deadline = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Deadline",
      placeHolder: "Optional due date or timestamp",
      value: item.priority.deadline ?? "",
    });
    if (deadline === undefined) {
      return;
    }

    const isBlocked = await promptForBlockedState(item.priority.isBlocked);
    if (isBlocked === undefined) {
      return;
    }

    const blockerReason = isBlocked
      ? await vscode.window.showInputBox({
          ignoreFocusOut: true,
          prompt: "Blocker reason",
          placeHolder: "Optional blocker details",
          value: item.priority.blockerReason ?? "",
        })
      : "";
    if (blockerReason === undefined) {
      return;
    }

    const sourceKind = await promptForSourceKind(item.source.kind);
    if (!sourceKind) {
      return;
    }

    const sourceExternalId = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Source reference",
      placeHolder: "Optional issue id, thread id, or ticket key",
      value: item.source.externalId ?? "",
    });
    if (sourceExternalId === undefined) {
      return;
    }

    const sourceUrl = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Source URL",
      placeHolder: "Optional URL to open from the detail panel",
      value: item.source.url ?? "",
      validateInput: validateOptionalUriInput,
    });
    if (sourceUrl === undefined) {
      return;
    }

    const sourcePath = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Source path",
      placeHolder: "Optional workspace-relative or absolute path",
      value: item.source.path ?? "",
    });
    if (sourcePath === undefined) {
      return;
    }

    const updated = await this.store.updateWorkItem(itemId, {
      priority: {
        blockerReason,
        deadline,
        isBlocked,
        level: priorityLevel,
        score: Number(priorityScoreValue),
      },
      source: {
        externalId: sourceExternalId,
        kind: sourceKind,
        path: sourcePath,
        url: sourceUrl,
      },
    });

    if (!updated) {
      void vscode.window.showWarningMessage("That work item metadata could not be updated.");
      return;
    }

    await this.refresh(`Updated metadata for "${updated.title}"`);
  }

  public async moveWorkItem(itemId: string): Promise<void> {
    const item = await this.getStoredWorkItemOrWarn(itemId);
    if (!item) {
      return;
    }

    const targetColumn = await promptForMoveColumn(item.column, this.store.getColumnDefinitions());
    if (!targetColumn) {
      return;
    }

    const moved = await this.store.moveItemToColumn(itemId, targetColumn, 0);
    if (!moved) {
      void vscode.window.showWarningMessage("That work item could not be moved.");
      return;
    }

    await this.refresh(`Moved "${moved.title}" to ${this.store.getColumnLabel(targetColumn)}`);
  }

  public async splitWorkItemFromPrompt(itemId: string): Promise<void> {
    const item = await this.getStoredWorkItemOrWarn(itemId);
    if (!item) {
      return;
    }

    const title = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: `Split "${item.title}" into a new work item`,
      placeHolder: "Add the next focused sub-task",
      validateInput: (value) => (value.trim().length > 0 ? null : "A title is required."),
    });
    if (!title) {
      return;
    }

    const description = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Split item description",
      placeHolder: "Leave blank to reuse the parent context",
      value: "",
    });
    if (description === undefined) {
      return;
    }

    const splitItem = await this.store.splitWorkItem(itemId, {
      description,
      title,
    });
    if (!splitItem) {
      void vscode.window.showWarningMessage("That work item could not be split.");
      return;
    }

    this.selectedItemId = splitItem.id;
    await this.refresh(`Created split task "${splitItem.title}"`);
  }

  public async openWorkItemSource(itemId: string): Promise<void> {
    const item = await this.getStoredWorkItemOrWarn(itemId);
    if (!item) {
      return;
    }

    const sourceTarget = item.source.url?.trim() || item.source.path?.trim();
    if (!sourceTarget) {
      void vscode.window.showWarningMessage("This work item does not have a source URL or path to open.");
      return;
    }

    if (item.source.url?.trim()) {
      const sourceUri = vscode.Uri.parse(item.source.url);
      if (!isAllowedSourceUri(sourceUri)) {
        void vscode.window.showWarningMessage("Only http and https source URLs can be opened from Work Terminal.");
        return;
      }

      const opened = await vscode.env.openExternal(sourceUri);
      if (!opened) {
        void vscode.window.showWarningMessage("That source URL could not be opened.");
      }
      return;
    }

    try {
      const sourceUri = resolveSourcePath(item.source.path ?? "");
      const document = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(document, { preview: true });
    } catch {
      void vscode.window.showWarningMessage("That source path could not be opened.");
    }
  }

  public async deleteWorkItemFromPrompt(itemId: string): Promise<void> {
    const item = await this.getStoredWorkItemOrWarn(itemId);
    if (!item) {
      return;
    }

    const activeSessionCount = this.terminalStore.getSummary().sessionCountByItemId[itemId] ?? 0;
    if (activeSessionCount > 0) {
      void vscode.window.showWarningMessage(
        `Close the ${activeSessionCount} open session${activeSessionCount === 1 ? "" : "s"} for "${item.title}" before deleting it.`,
      );
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Delete "${item.title}"? This removes the work item from the board.`,
      { modal: true },
      "Delete",
    );
    if (confirmation !== "Delete") {
      return;
    }

    const deleted = await this.store.deleteWorkItem(itemId);
    if (!deleted) {
      void vscode.window.showWarningMessage("That work item could not be deleted.");
      return;
    }

    if (this.selectedItemId === itemId) {
      this.selectedItemId = null;
    }
    await this.refresh(`Deleted "${item.title}"`);
  }

  public async showMoreActionsForItem(itemId: string): Promise<void> {
    const item = await this.getStoredWorkItemOrWarn(itemId);
    if (!item) {
      return;
    }

    const action = await promptForWorkItemAction(item, this.store.getColumnDefinitions());
    switch (action) {
      case "delete":
        await this.deleteWorkItemFromPrompt(itemId);
        return;
      case "edit-details":
        await this.editWorkItemDetails(itemId);
        return;
      case "edit-metadata":
        await this.editWorkItemMetadata(itemId);
        return;
      case "move":
        await this.moveWorkItem(itemId);
        return;
      case "open-source":
        await this.openWorkItemSource(itemId);
        return;
      case "split":
        await this.splitWorkItemFromPrompt(itemId);
        return;
      default:
        return;
    }
  }

  public async manageProfilesFromPrompt(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("workTerminal");
    const catalog = loadAgentProfileCatalog(configuration);
    const profiles = [...catalog.profiles];
    const action = await promptForProfileAction();

    if (!action) {
      return;
    }

    if (action === "create") {
      const created = await promptForProfile(undefined, profiles.map((profile) => profile.id));
      if (!created) {
        return;
      }

      profiles.push(created);
      await this.saveProfiles(profiles, `Added profile "${created.label}"`);
      return;
    }

    if (action === "reset") {
      await configuration.update(AGENT_PROFILES_CONFIGURATION_KEY, undefined, getConfigurationTarget());
      await this.refresh("Reset profile configuration to the built-in defaults");
      void vscode.window.showInformationMessage("Reset Work Terminal profiles to the built-in defaults.");
      return;
    }

    const selectedProfile = await promptForExistingProfile(profiles, action, catalog.issues.length);
    if (!selectedProfile) {
      return;
    }

    if (action === "edit") {
      const updated = await promptForProfile(selectedProfile, profiles
        .filter((profile) => profile.id !== selectedProfile.id)
        .map((profile) => profile.id));
      if (!updated) {
        return;
      }

      const nextProfiles = profiles.map((profile) => profile.id === selectedProfile.id ? updated : profile);
      await this.saveProfiles(nextProfiles, `Updated profile "${updated.label}"`);
      return;
    }

    if (action === "delete") {
      const confirmation = await vscode.window.showWarningMessage(
        `Delete the profile "${selectedProfile.label}"?`,
        { modal: true },
        "Delete",
      );
      if (confirmation !== "Delete") {
        return;
      }

      await this.saveProfiles(
        profiles.filter((profile) => profile.id !== selectedProfile.id),
        `Deleted profile "${selectedProfile.label}"`,
      );
      return;
    }

    const profileIndex = profiles.findIndex((profile) => profile.id === selectedProfile.id);
    const direction = action === "move-up" ? -1 : 1;
    const targetIndex = profileIndex + direction;
    if (profileIndex < 0 || targetIndex < 0 || targetIndex >= profiles.length) {
      void vscode.window.showWarningMessage(`"${selectedProfile.label}" cannot move any further.`);
      return;
    }

    const nextProfiles = [...profiles];
    [nextProfiles[profileIndex], nextProfiles[targetIndex]] = [nextProfiles[targetIndex], nextProfiles[profileIndex]];
    await this.saveProfiles(nextProfiles, `Reordered profile "${selectedProfile.label}"`);
  }

  public async launchShell(itemId: string, itemTitle: string, itemDescription: string | null): Promise<void> {
    const result = await this.terminalStore.createShellSession(itemId, itemTitle, itemDescription, undefined);

    if (!result.session) {
      void vscode.window.showWarningMessage(result.error ?? "Unable to launch that shell session.");
      return;
    }

    await this.refresh(`Opened shell session "${result.session.label}"`);
  }

  public async launchAgent(
    profileId: AgentProfileId,
    itemId: string,
    itemTitle: string,
    itemDescription: string | null,
  ): Promise<void> {
    const result = await this.terminalStore.createAgentSession({
      cwd: undefined,
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

  public async reopenRecentlyClosedSession(sessionId: string): Promise<void> {
    const result = await this.terminalStore.reopenRecentlyClosedSession(sessionId);

    if (!result.session) {
      void vscode.window.showWarningMessage(result.error ?? "Unable to reopen that recently closed session.");
      return;
    }

    await this.refresh(`Reopened ${result.session.profileLabel ?? result.session.kind} session "${result.session.label}"`);
  }

  private async postState(status: string): Promise<void> {
    const state = await this.createViewState(status);

    await this.view?.webview.postMessage({
      type: "state-updated",
      payload: state,
    });
  }

  private async createViewState(status: string): Promise<WorkTerminalViewState> {
    const summary = await this.store.getSummary(this.selectedItemId);
    this.selectedItemId = summary.selectedItemId;
    const terminalSummary = this.terminalStore.getSummary();

    return {
      agentProfiles: terminalSummary.agentProfiles,
      boardColumns: summary.boardColumns,
      collapsedColumns: summary.collapsedColumns,
      columnSummaries: summary.columnSummaries,
      configurationIssues: terminalSummary.configurationIssues,
      latestWorkItemTitle: summary.latestWorkItemTitle,
      launchConfiguration: terminalSummary.launchConfiguration,
      recentlyClosedSessions: terminalSummary.recentlyClosedSessions,
      selectedItem: summary.selectedItem,
      selectedItemId: summary.selectedItemId,
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

  private async saveProfiles(profiles: readonly AgentProfile[], status: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("workTerminal");
    await configuration.update(
      AGENT_PROFILES_CONFIGURATION_KEY,
      serializeAgentProfiles(profiles),
      getConfigurationTarget(),
    );
    await this.refresh(status);
    void vscode.window.showInformationMessage(status);
  }

  private async openSettings(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "@ext:tomcorke.vscode-work-terminal-v3 workTerminal",
    );
  }

  private async getStoredWorkItemOrWarn(itemId: string): Promise<WorkItem | null> {
    const item = await this.store.getWorkItem(itemId);
    if (!item) {
      void vscode.window.showWarningMessage("That work item no longer exists.");
      return null;
    }

    return item;
  }
}

async function promptForState(
  columnDefinitions: readonly WorkItemColumnDefinition[],
): Promise<"priority" | "todo" | "active" | "done" | undefined> {
  const choices = columnDefinitions.map((columnDefinition) => ({
    label: columnDefinition.label,
    state: columnDefinition.id,
  }));

  const selection = await vscode.window.showQuickPick(choices, {
    ignoreFocusOut: true,
    placeHolder: "Choose the initial state",
  });

  return selection?.state as "priority" | "todo" | "active" | "done" | undefined;
}

async function promptForProfileAction(): Promise<"create" | "delete" | "edit" | "move-down" | "move-up" | "reset" | undefined> {
  const selection = await vscode.window.showQuickPick([
    { label: "Create profile", value: "create" },
    { label: "Edit profile", value: "edit" },
    { label: "Delete profile", value: "delete" },
    { label: "Move profile up", value: "move-up" },
    { label: "Move profile down", value: "move-down" },
    { label: "Reset to built-in defaults", value: "reset" },
  ] as const, {
    ignoreFocusOut: true,
    placeHolder: "Manage agent profiles",
  });

  return selection?.value;
}

async function promptForExistingProfile(
  profiles: readonly AgentProfile[],
  action: "delete" | "edit" | "move-down" | "move-up",
  issueCount: number,
): Promise<AgentProfile | undefined> {
  if (profiles.length === 0) {
    void vscode.window.showWarningMessage("No profiles are configured yet. Create one first.");
    return undefined;
  }

  const selection = await vscode.window.showQuickPick(
    profiles.map((profile, index) => ({
      description: `${profile.kind}${profile.usesContext ? " · ctx" : ""}${profile.builtIn ? " · built-in" : ""}`,
      detail: `${index + 1}. ${profile.command}${issueCount > 0 ? ` · ${issueCount} config issue${issueCount === 1 ? "" : "s"} currently shown in the board` : ""}`,
      label: profile.label,
      profile,
    })),
    {
      ignoreFocusOut: true,
      placeHolder: `Select a profile to ${action.replaceAll("-", " ")}`,
    },
  );

  return selection?.profile;
}

async function promptForProfile(
  existingProfile: AgentProfile | undefined,
  otherProfileIds: readonly string[],
): Promise<AgentProfile | undefined> {
  const label = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: existingProfile ? `Edit profile label for ${existingProfile.label}` : "Create a profile label",
    placeHolder: "Team agent",
    value: existingProfile?.label ?? "",
    validateInput: (value) => value.trim().length > 0 ? null : "A label is required.",
  });
  if (!label) {
    return undefined;
  }

  const id = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: "Profile id",
    placeHolder: "team-agent",
    value: existingProfile?.id ?? slugifyProfileId(label),
    validateInput: (value) => validateProfileId(value, otherProfileIds),
  });
  if (!id) {
    return undefined;
  }

  const kind = await promptForProfileKind();
  if (!kind) {
    return undefined;
  }

  const command = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: `Command used to launch ${label}`,
    placeHolder: kind === "custom" ? "my-agent --interactive" : kind,
    value: existingProfile?.command ?? kind,
    validateInput: (value) => value.trim().length > 0 ? null : "A launch command is required.",
  });
  if (!command) {
    return undefined;
  }

  const extraArgs = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: `Extra arguments for ${label}`,
    placeHolder: "--model fast",
    value: existingProfile?.extraArgs ?? "",
  });
  if (extraArgs === undefined) {
    return undefined;
  }

  const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  const workingDirectory = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: `Working directory override for ${label}`,
    placeHolder: "Leave blank to use the Settings default",
    value: existingProfile?.workingDirectory ?? "",
    validateInput: (value) => {
      return resolveConfiguredWorkingDirectory(
        value,
        workspaceRootPath,
        `workTerminal.agentProfiles.${existingProfile?.id ?? "new"}.workingDirectory`,
      ).error?.message ?? null;
    },
  });
  if (workingDirectory === undefined) {
    return undefined;
  }

  const usesContext = await promptForContextBehavior();
  if (usesContext === undefined) {
    return undefined;
  }

  return {
    builtIn: Boolean(getBuiltInAgentProfileById(id.trim())),
    command: command.trim(),
    extraArgs,
    id: id.trim(),
    kind,
    label: label.trim(),
    usesContext,
    workingDirectory: workingDirectory.trim() || undefined,
  };
}

async function promptForProfileKind(): Promise<AgentKind | undefined> {
  const selection = await vscode.window.showQuickPick([
    { description: "Resume-aware Claude launcher", label: "Claude", value: "claude" },
    { description: "GitHub Copilot CLI launcher", label: "Copilot", value: "copilot" },
    { description: "Strands launcher", label: "Strands", value: "strands" },
    { description: "Generic command without built-in session semantics", label: "Custom", value: "custom" },
  ] as const, {
    ignoreFocusOut: true,
    placeHolder: "Choose the agent type",
  });

  return selection?.value;
}

async function promptForContextBehavior(): Promise<boolean | undefined> {
  const selection = await vscode.window.showQuickPick([
    { description: "Launch the command directly", label: "Do not send work item context", value: false },
    { description: "Send the work item prompt after launch", label: "Send work item context after launch", value: true },
  ] as const, {
    ignoreFocusOut: true,
    placeHolder: "Choose the context behavior",
  });

  return selection?.value;
}

function validateProfileId(value: string, existingIds: readonly string[]): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return "A profile id is required.";
  }

  if (!/^[a-z0-9-]+$/u.test(normalized)) {
    return "Use lowercase letters, numbers, and hyphens only.";
  }

  if (existingIds.includes(normalized)) {
    return "That profile id already exists.";
  }

  return null;
}

function slugifyProfileId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    || "profile";
}

function getConfigurationTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

async function promptForPriorityLevel(
  currentLevel: WorkItemPriorityLevel,
): Promise<WorkItemPriorityLevel | undefined> {
  const selection = await vscode.window.showQuickPick(
    [
      { label: "None", value: "none" },
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
      { label: "Critical", value: "critical" },
    ] as const,
    {
      ignoreFocusOut: true,
      placeHolder: `Priority level - current ${currentLevel}`,
    },
  );

  return selection?.value;
}

function validatePriorityScoreInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return "Use a number from 0 to 100.";
  }

  return null;
}

async function promptForBlockedState(currentValue: boolean): Promise<boolean | undefined> {
  const selection = await vscode.window.showQuickPick(
    [
      { description: "No blocker metadata is shown", label: "Not blocked", value: false },
      { description: "Shows blocker metadata in the detail panel", label: "Blocked", value: true },
    ] as const,
    {
      ignoreFocusOut: true,
      placeHolder: `Blocked state - current ${currentValue ? "blocked" : "not blocked"}`,
    },
  );

  return selection?.value;
}

async function promptForSourceKind(currentKind: WorkItemSourceKind): Promise<WorkItemSourceKind | undefined> {
  const selection = await vscode.window.showQuickPick(
    [
      { label: "Manual", value: "manual" },
      { label: "Prompt", value: "prompt" },
      { label: "Jira", value: "jira" },
      { label: "Slack", value: "slack" },
      { label: "Confluence", value: "confluence" },
      { label: "Markdown", value: "markdown" },
      { label: "Other", value: "other" },
    ] as const,
    {
      ignoreFocusOut: true,
      placeHolder: `Source kind - current ${currentKind}`,
    },
  );

  return selection?.value;
}

async function promptForMoveColumn(
  currentColumn: WorkItemColumn,
  columnDefinitions: readonly WorkItemColumnDefinition[],
): Promise<WorkItemColumn | undefined> {
  const options = columnDefinitions.map((columnDefinition) => ({
    description: `Move to the ${columnDefinition.label} column`,
    label: columnDefinition.label,
    value: columnDefinition.id,
  }));
  const selection = await vscode.window.showQuickPick(
    options.filter((option) => option.value !== currentColumn),
    {
      ignoreFocusOut: true,
      placeHolder: `Move work item from ${labelForColumn(currentColumn, columnDefinitions)}`,
    },
  );

  return selection?.value;
}

type WorkItemAction = "delete" | "edit-details" | "edit-metadata" | "move" | "open-source" | "split";

async function promptForWorkItemAction(
  item: WorkItem,
  columnDefinitions: readonly WorkItemColumnDefinition[],
): Promise<WorkItemAction | undefined> {
  const options = [
    {
      description: "Edit the title and description",
      label: "Edit details",
      value: "edit-details",
    },
    {
      description: "Edit priority, blocker, deadline, and source metadata",
      label: "Edit metadata",
      value: "edit-metadata",
    },
    {
      description: `Current column: ${labelForColumn(item.column, columnDefinitions)}`,
      label: "Move item",
      value: "move",
    },
    {
      description: "Create a derived work item and keep the parent context",
      label: "Split task",
      value: "split",
    },
    {
      description: item.source.url?.trim() || item.source.path?.trim()
        ? item.source.url?.trim() ?? item.source.path?.trim() ?? ""
        : "No source URL or path is set",
      disabled: !(item.source.url?.trim() || item.source.path?.trim()),
      label: "Open source",
      value: "open-source",
    },
    {
      description: "Remove the work item from the board",
      label: "Delete item",
      value: "delete",
    },
  ] as const;

  const selection = await vscode.window.showQuickPick(
    options
      .filter((option) => !("disabled" in option && option.disabled))
      .map((option) => ({
        description: option.description,
        label: option.label,
        value: option.value,
      })),
    {
      ignoreFocusOut: true,
      placeHolder: `More actions for ${item.title}`,
    },
  );

  return selection?.value;
}

function validateOptionalUriInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = vscode.Uri.parse(trimmed);
    return isAllowedSourceUri(parsed) ? null : "Use an http or https URL, or leave blank.";
  } catch {
    return "Use an http or https URL, or leave blank.";
  }
}

function labelForColumn(column: WorkItemColumn, columnDefinitions: readonly WorkItemColumnDefinition[]): string {
  return columnDefinitions.find((columnDefinition) => columnDefinition.id === column)?.label ?? column;
}

function resolveSourcePath(pathValue: string): vscode.Uri {
  if (isAbsolutePath(pathValue)) {
    return vscode.Uri.file(pathValue);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error("No workspace is open.");
  }

  return vscode.Uri.joinPath(workspaceFolder.uri, pathValue);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[a-z]:[\\/]/iu.test(value);
}

function isAllowedSourceUri(uri: vscode.Uri): boolean {
  return uri.scheme === "http" || uri.scheme === "https";
}
