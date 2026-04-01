import * as vscode from "vscode";

import {
  buildAgentLaunchPlan,
  buildWorkItemContextPrompt,
  getAgentProfileById,
  getNormalizedConfiguredCommand,
  getAgentProfileSummaries,
  type AgentProfileId,
  type AgentProfileSummary,
} from "../agents";

export interface TerminalSessionSummary {
  readonly command: string | null;
  readonly id: string;
  readonly itemDescription: string | null;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly kind: "claude" | "copilot" | "shell";
  readonly label: string;
  readonly profileId: AgentProfileId | null;
  readonly profileLabel: string | null;
  readonly resumeSessionId: string | null;
  readonly statusLabel: string;
}

export interface TerminalStoreSummary {
  readonly agentProfiles: readonly AgentProfileSummary[];
  readonly sessionCountByItemId: Record<string, number>;
  readonly sessions: readonly TerminalSessionSummary[];
}

interface StoredTerminalSession {
  readonly summary: TerminalSessionSummary;
  readonly terminal: vscode.Terminal;
}

export class TerminalSessionStore implements vscode.Disposable {
  private readonly closeDisposable: vscode.Disposable;
  private readonly sessionsChangedEmitter = new vscode.EventEmitter<void>();
  private readonly sessionsById = new Map<string, StoredTerminalSession>();

  public constructor() {
    this.closeDisposable = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [id, session] of this.sessionsById) {
        if (session.terminal === terminal) {
          this.sessionsById.delete(id);
          this.sessionsChangedEmitter.fire();
        }
      }
    });
  }

  public get onDidChangeSessions(): vscode.Event<void> {
    return this.sessionsChangedEmitter.event;
  }

  public createShellSession(itemId: string, itemTitle: string, itemDescription: string | null, cwd: string | undefined): TerminalSessionSummary {
    const id = crypto.randomUUID();
    const label = `${itemTitle} - Shell`;
    const terminal = vscode.window.createTerminal({
      cwd,
      name: label,
    });
    const summary: TerminalSessionSummary = {
      command: null,
      id,
      itemDescription,
      itemId,
      itemTitle,
      kind: "shell",
      label,
      profileId: null,
      profileLabel: null,
      resumeSessionId: null,
      statusLabel: "Local shell session",
    };

    this.sessionsById.set(id, { summary, terminal });
    this.sessionsChangedEmitter.fire();
    terminal.show(true);

    return summary;
  }

  public createAgentSession(options: {
    readonly cwd: string | undefined;
    readonly itemDescription: string | null;
    readonly itemId: string;
    readonly itemTitle: string;
    readonly profileId: AgentProfileId;
  }): { readonly error: string | null; readonly session: TerminalSessionSummary | null } {
    const configuration = vscode.workspace.getConfiguration("workTerminal");
    const profile = getAgentProfileById(options.profileId);

    if (!profile) {
      return {
        error: `Unknown agent profile "${options.profileId}".`,
        session: null,
      };
    }

    const profileSummary = getAgentProfileSummaries(configuration).find((summary) => summary.id === options.profileId);
    if (!profileSummary || profileSummary.status !== "ready") {
      return {
        error: `${profile.label} is not available. ${profileSummary?.statusLabel ?? "Check the configured command in settings."}`,
        session: null,
      };
    }

    const configuredCommand = getNormalizedConfiguredCommand(
      configuration.get<string>(profile.commandConfigurationKey, profile.defaultCommand),
      profile.defaultCommand,
    );
    const configuredExtraArgs = configuration.get<string>(profile.extraArgsConfigurationKey, "") ?? "";
    const contextPrompt = buildWorkItemContextPrompt(options.itemTitle, options.itemDescription);
    let launchPlan;
    try {
      launchPlan = buildAgentLaunchPlan({
        configuredCommand,
        configuredExtraArgs,
        contextPrompt,
        profile,
      });
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : `Unable to launch ${profile.label}.`,
        session: null,
      };
    }
    const id = crypto.randomUUID();
    const label = `${options.itemTitle} - ${profile.label}`;
    const terminal = vscode.window.createTerminal({
      cwd: options.cwd,
      name: label,
      shellArgs: [...launchPlan.args],
      shellPath: launchPlan.executable,
    });
    const summary: TerminalSessionSummary = {
      command: configuredCommand.trim(),
      id,
      itemDescription: options.itemDescription,
      itemId: options.itemId,
      itemTitle: options.itemTitle,
      kind: profile.kind,
      label,
      profileId: profile.id,
      profileLabel: profile.label,
      resumeSessionId: launchPlan.sessionId,
      statusLabel: profile.usesContext
        ? `${profileSummary.statusLabel}. Context prompt sent after launch.`
        : profileSummary.resumeBehaviorLabel,
    };

    this.sessionsById.set(id, { summary, terminal });
    this.sessionsChangedEmitter.fire();
    terminal.show(true);

    const initialPrompt = launchPlan.initialPrompt;
    if (initialPrompt) {
      setTimeout(() => {
        terminal.sendText(initialPrompt, true);
      }, 200);
    }

    return {
      error: null,
      session: summary,
    };
  }

  public focusSession(id: string): boolean {
    const session = this.sessionsById.get(id);
    if (!session) {
      return false;
    }

    session.terminal.show(true);
    return true;
  }

  public getSummary(): TerminalStoreSummary {
    const sessions = Array.from(this.sessionsById.values()).map((session) => session.summary);
    const sessionCountByItemId: Record<string, number> = {};

    for (const session of sessions) {
      sessionCountByItemId[session.itemId] = (sessionCountByItemId[session.itemId] ?? 0) + 1;
    }

    return {
      agentProfiles: getAgentProfileSummaries(vscode.workspace.getConfiguration("workTerminal")),
      sessionCountByItemId,
      sessions,
    };
  }

  public dispose(): void {
    this.closeDisposable.dispose();
    for (const session of this.sessionsById.values()) {
      session.terminal.dispose();
    }
    this.sessionsChangedEmitter.dispose();
    this.sessionsById.clear();
  }
}
