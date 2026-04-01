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
import {
  TerminalSessionPersistence,
  type PersistedTerminalSession,
} from "./TerminalSessionPersistence";

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
  readonly persisted: PersistedTerminalSession;
  readonly summary: TerminalSessionSummary;
  readonly terminal: vscode.Terminal;
}

export class TerminalSessionStore implements vscode.Disposable {
  private readonly closeDisposable: vscode.Disposable;
  private readonly pendingInitialPromptTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly persistence: TerminalSessionPersistence;
  private readonly sessionsChangedEmitter = new vscode.EventEmitter<void>();
  private readonly sessionsById = new Map<string, StoredTerminalSession>();

  public constructor(workspaceRootPath: string | null) {
    this.persistence = new TerminalSessionPersistence(workspaceRootPath);
    this.closeDisposable = vscode.window.onDidCloseTerminal((terminal) => {
      void this.handleClosedTerminal(terminal);
    });
  }

  public get onDidChangeSessions(): vscode.Event<void> {
    return this.sessionsChangedEmitter.event;
  }

  public getStoragePath(): string | null {
    return this.persistence.getStoragePath();
  }

  public async createShellSession(
    itemId: string,
    itemTitle: string,
    itemDescription: string | null,
    cwd: string | undefined,
    options: {
      readonly existingId?: string;
      readonly persist?: boolean;
      readonly reveal?: boolean;
    } = {},
  ): Promise<TerminalSessionSummary> {
    const id = options.existingId ?? crypto.randomUUID();
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

    const persisted: PersistedTerminalSession = {
      command: null,
      cwd: cwd ?? null,
      id,
      itemDescription,
      itemId,
      itemTitle,
      kind: "shell",
      label,
      profileId: null,
      profileLabel: null,
      resumeSessionId: null,
      statusLabel: summary.statusLabel,
    };

    this.sessionsById.set(id, { persisted, summary, terminal });
    this.sessionsChangedEmitter.fire();
    if (options.persist !== false) {
      await this.persistSession(persisted);
    }

    if (options.reveal !== false) {
      terminal.show(true);
    }

    return summary;
  }

  public async createAgentSession(
    options: {
      readonly cwd: string | undefined;
      readonly itemDescription: string | null;
      readonly itemId: string;
      readonly itemTitle: string;
      readonly profileId: AgentProfileId;
    },
    createOptions: {
      readonly existingId?: string;
      readonly persist?: boolean;
      readonly reveal?: boolean;
      readonly resumeSessionId?: string | null;
    } = {},
  ): Promise<{ readonly error: string | null; readonly session: TerminalSessionSummary | null }> {
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
        resumeSessionId: createOptions.resumeSessionId,
      });
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : `Unable to launch ${profile.label}.`,
        session: null,
      };
    }
    const id = createOptions.existingId ?? crypto.randomUUID();
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

    const persisted: PersistedTerminalSession = {
      command: summary.command,
      cwd: options.cwd ?? null,
      id,
      itemDescription: options.itemDescription,
      itemId: options.itemId,
      itemTitle: options.itemTitle,
      kind: profile.kind,
      label,
      profileId: profile.id,
      profileLabel: profile.label,
      resumeSessionId: summary.resumeSessionId,
      statusLabel: summary.statusLabel,
    };

    this.sessionsById.set(id, { persisted, summary, terminal });
    this.sessionsChangedEmitter.fire();
    if (createOptions.persist !== false) {
      await this.persistSession(persisted);
    }

    if (createOptions.reveal !== false) {
      terminal.show(true);
    }

    const initialPrompt = launchPlan.initialPrompt;
    if (initialPrompt) {
      const timer = setTimeout(() => {
        this.pendingInitialPromptTimers.delete(id);

        const activeSession = this.sessionsById.get(id);
        if (!activeSession || activeSession.terminal !== terminal) {
          return;
        }

        terminal.sendText(initialPrompt, true);
      }, 200);
      this.pendingInitialPromptTimers.set(id, timer);
    }

    return {
      error: null,
      session: summary,
    };
  }

  public async restorePersistedSessions(): Promise<{
    readonly restoredCount: number;
    readonly skippedCount: number;
  }> {
    const sessions = await this.persistence.loadSessions();
    let restoredCount = 0;
    let skippedCount = 0;

    for (const session of sessions) {
      if (session.kind === "shell") {
        await this.createShellSession(
          session.itemId,
          session.itemTitle,
          session.itemDescription,
          session.cwd ?? undefined,
          {
            existingId: session.id,
            reveal: false,
          },
        );
        restoredCount += 1;
        continue;
      }

      if (!session.profileId) {
        skippedCount += 1;
        continue;
      }

      const result = await this.createAgentSession(
        {
          cwd: session.cwd ?? undefined,
          itemDescription: session.itemDescription,
          itemId: session.itemId,
          itemTitle: session.itemTitle,
          profileId: session.profileId,
        },
        {
          existingId: session.id,
          resumeSessionId: session.resumeSessionId,
          reveal: false,
        },
      );

      if (result.session) {
        restoredCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    return {
      restoredCount,
      skippedCount,
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
    for (const timer of this.pendingInitialPromptTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingInitialPromptTimers.clear();
    this.sessionsChangedEmitter.dispose();
    this.sessionsById.clear();
  }

  private async handleClosedTerminal(terminal: vscode.Terminal): Promise<void> {
    for (const [id, session] of this.sessionsById) {
      if (session.terminal !== terminal) {
        continue;
      }

      this.clearPendingInitialPrompt(id);
      this.sessionsById.delete(id);
      this.sessionsChangedEmitter.fire();
      await this.deletePersistedSession(id);
      return;
    }
  }

  private clearPendingInitialPrompt(id: string): void {
    const timer = this.pendingInitialPromptTimers.get(id);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.pendingInitialPromptTimers.delete(id);
  }

  private async deletePersistedSession(id: string): Promise<void> {
    try {
      await this.persistence.deleteSession(id);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }

      console.warn(
        `[work-terminal] Failed to delete persisted terminal session "${id}".`,
        error,
      );
    }
  }

  private async persistSession(session: PersistedTerminalSession): Promise<void> {
    try {
      await this.persistence.upsertSession(session);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }

      console.warn(
        `[work-terminal] Failed to persist terminal session "${session.id}".`,
        error,
      );
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}
