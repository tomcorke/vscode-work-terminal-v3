import * as vscode from "vscode";

import {
  getBuiltInAgentProfileById,
  loadAgentProfileCatalog,
  serializeAgentProfiles,
  type AgentKind,
  type AgentProfile,
  type AgentProfileId,
} from "../agents";
import type { TerminalSessionStore } from "../terminals";
import type { WorkItemStore } from "../workItems";
import { getNonce } from "./getNonce";
import {
  renderWorkTerminalHtml,
  type WorkTerminalViewState,
} from "./renderWorkTerminalHtml";

const AGENT_PROFILES_CONFIGURATION_SECTION = "agentProfiles";

type WorkTerminalWebviewMessage =
  | { readonly type: "ready"; readonly selectedItemId: string | null }
  | { readonly type: "create-work-item-requested" }
  | { readonly type: "focus-terminal-requested"; readonly terminalId: string }
  | { readonly type: "manage-profiles-requested" }
  | {
      readonly type: "reorder-item-requested";
      readonly fromColumn: "priority" | "todo" | "active" | "done";
      readonly itemId: string;
      readonly targetIndex: number;
      readonly toColumn: "priority" | "todo" | "active" | "done";
    }
  | { readonly type: "reopen-recent-session-requested"; readonly sessionId: string }
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

        if (message.type === "manage-profiles-requested") {
          await this.manageProfilesFromPrompt();
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
      await configuration.update(AGENT_PROFILES_CONFIGURATION_SECTION, undefined, getConfigurationTarget());
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
      collapsedColumns: summary.collapsedColumns,
      columnSummaries: summary.columnSummaries,
      latestWorkItemTitle: summary.latestWorkItemTitle,
      profileIssues: terminalSummary.profileIssues,
      recentlyClosedSessions: terminalSummary.recentlyClosedSessions,
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

  private async saveProfiles(profiles: readonly AgentProfile[], status: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("workTerminal");
    await configuration.update(
      AGENT_PROFILES_CONFIGURATION_SECTION,
      serializeAgentProfiles(profiles),
      getConfigurationTarget(),
    );
    await this.refresh(status);
    void vscode.window.showInformationMessage(status);
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
