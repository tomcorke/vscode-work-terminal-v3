import * as vscode from "vscode";

import {
  buildAgentLaunchPlan,
  type ConfigurationIssue,
  getAgentProfileSummaries,
  loadAgentProfileCatalog,
  type AgentProfileId,
  type AgentProfileSummary,
} from "../agents";
import {
  createBuiltInJsonWorkItemSourceAdapter,
  type WorkItemSourcePromptBuilder,
} from "../workItems";
import {
  loadTerminalLaunchConfiguration,
  resolveAgentProfileWorkingDirectory,
  type TerminalLaunchConfigurationSummary,
} from "./TerminalLaunchConfiguration";
import {
  type RecentlyClosedTerminalSession,
  TerminalSessionPersistence,
  type PersistedTerminalSession,
} from "./TerminalSessionPersistence";

const AGENT_ACTIVE_WINDOW_MS = 15_000;
const AGENT_IDLE_AFTER_MS = 5 * 60 * 1000;
const TERMINAL_MONITOR_INTERVAL_MS = 2_000;

export type AgentActivityState = "active" | "idle" | "waiting";

export interface TerminalSessionSummary {
  readonly activityState: AgentActivityState | null;
  readonly activityStateLabel: string | null;
  readonly command: string | null;
  readonly id: string;
  readonly itemDescription: string | null;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly kind: "claude" | "copilot" | "custom" | "shell" | "strands";
  readonly label: string;
  readonly profileId: AgentProfileId | null;
  readonly profileLabel: string | null;
  readonly resumeSessionId: string | null;
  readonly statusLabel: string;
}

export interface TerminalStoreSummary {
  readonly agentProfiles: readonly AgentProfileSummary[];
  readonly configurationIssues: readonly ConfigurationIssue[];
  readonly launchConfiguration: {
    readonly defaultWorkingDirectoryLabel: string;
    readonly shellStatusLabel: string;
  };
  readonly recentlyClosedSessions: readonly RecentlyClosedTerminalSession[];
  readonly sessionCountByItemId: Record<string, number>;
  readonly sessions: readonly TerminalSessionSummary[];
}

interface StoredTerminalSession {
  readonly createdAt: number;
  readonly hasObservedSignal: boolean;
  readonly lastActivityAt: number;
  readonly lastObservedTerminalName: string;
  readonly persisted: PersistedTerminalSession;
  readonly summary: TerminalSessionSummary;
  readonly terminal: vscode.Terminal;
}

export class TerminalSessionStore implements vscode.Disposable {
  private readonly closeDisposable: vscode.Disposable;
  private readonly monitorInterval: ReturnType<typeof setInterval>;
  private readonly pendingInitialPromptTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly persistence: TerminalSessionPersistence;
  private readonly promptBuilder: WorkItemSourcePromptBuilder;
  private refreshSessionTrackingPromise: Promise<void> | null = null;
  private recentlyClosedSessions: readonly RecentlyClosedTerminalSession[] = [];
  private readonly sessionsChangedEmitter = new vscode.EventEmitter<void>();
  private readonly sessionsById = new Map<string, StoredTerminalSession>();
  private readonly terminalStateDisposable: vscode.Disposable;

  public constructor(
    private readonly workspaceRootPath: string | null,
    promptBuilder: WorkItemSourcePromptBuilder = createBuiltInJsonWorkItemSourceAdapter().promptBuilder,
  ) {
    this.persistence = new TerminalSessionPersistence(workspaceRootPath);
    this.promptBuilder = promptBuilder;
    this.closeDisposable = vscode.window.onDidCloseTerminal((terminal) => {
      void this.handleClosedTerminal(terminal);
    });
    this.terminalStateDisposable = vscode.window.onDidChangeTerminalState((terminal) => {
      this.handleTerminalStateChange(terminal);
    });
    this.monitorInterval = setInterval(() => {
      this.queueRefreshSessionTracking();
    }, TERMINAL_MONITOR_INTERVAL_MS);
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
      readonly emitChange?: boolean;
      readonly existingId?: string;
      readonly persist?: boolean;
      readonly reveal?: boolean;
    } = {},
  ): Promise<{ readonly error: string | null; readonly session: TerminalSessionSummary | null }> {
    const launchConfiguration = this.loadLaunchConfiguration();
    const resolvedCwd = cwd ?? launchConfiguration.defaultWorkingDirectory;
    if (!cwd && launchConfiguration.issues.some((issue) => issue.settingPath === "workTerminal.defaultWorkingDirectory")) {
      return {
        error: buildConfigurationErrorMessage(
          "Shell sessions cannot start until the default working directory is fixed.",
          launchConfiguration,
          ["workTerminal.defaultWorkingDirectory"],
        ),
        session: null,
      };
    }
    if (launchConfiguration.shellCommand && !launchConfiguration.shellExecutable) {
      return {
        error: buildConfigurationErrorMessage(
          "Shell sessions cannot start until the configured shell command is fixed.",
          launchConfiguration,
          ["workTerminal.shellCommand", "workTerminal.shellExtraArgs"],
        ),
        session: null,
      };
    }

    const id = options.existingId ?? crypto.randomUUID();
    const label = `${itemTitle} - Shell`;
    const terminal = vscode.window.createTerminal({
      cwd: resolvedCwd,
      name: label,
      shellArgs: launchConfiguration.shellCommand ? [...launchConfiguration.shellArgs] : undefined,
      shellPath: launchConfiguration.shellExecutable,
    });
    const summary: TerminalSessionSummary = {
      activityState: null,
      activityStateLabel: null,
      command: launchConfiguration.shellCommand,
      id,
      itemDescription,
      itemId,
      itemTitle,
      kind: "shell",
      label,
      profileId: null,
      profileLabel: null,
      resumeSessionId: null,
      statusLabel: launchConfiguration.shellStatusLabel,
    };

    const persisted: PersistedTerminalSession = {
      command: launchConfiguration.shellCommand,
      cwd: resolvedCwd ?? null,
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

    this.sessionsById.set(id, {
      createdAt: Date.now(),
      hasObservedSignal: false,
      lastActivityAt: Date.now(),
      lastObservedTerminalName: label.trim(),
      persisted,
      summary,
      terminal,
    });
    if (options.persist !== false) {
      await this.persistSession(persisted);
    }
    if (options.emitChange !== false) {
      this.sessionsChangedEmitter.fire();
    }

    if (options.reveal !== false) {
      terminal.show(true);
    }

    return { error: null, session: summary };
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
      readonly emitChange?: boolean;
      readonly existingId?: string;
      readonly existingLabel?: string;
      readonly persist?: boolean;
      readonly reveal?: boolean;
      readonly resumeSessionId?: string | null;
      readonly skipInitialPrompt?: boolean;
    } = {},
  ): Promise<{ readonly error: string | null; readonly session: TerminalSessionSummary | null }> {
    const configuration = vscode.workspace.getConfiguration("workTerminal");
    const catalog = loadAgentProfileCatalog(configuration);
    const launchConfiguration = this.loadLaunchConfiguration(configuration);
    const profile = catalog.profiles.find((candidate) => candidate.id === options.profileId);

    if (!profile) {
      return {
        error: `Unknown agent profile "${options.profileId}". Use Manage Profiles to add it back or choose a different profile.`,
        session: null,
      };
    }

    const profileSummary = getAgentProfileSummaries(catalog.profiles, {
      getWorkingDirectoryLabel: (candidate) => {
        return resolveAgentProfileWorkingDirectory(
          candidate,
          this.workspaceRootPath,
          launchConfiguration.defaultWorkingDirectory,
        ).label;
      },
      getWorkingDirectoryStatus: (candidate) => {
        const resolvedWorkingDirectory = resolveAgentProfileWorkingDirectory(
          candidate,
          this.workspaceRootPath,
          launchConfiguration.defaultWorkingDirectory,
        );
        return resolvedWorkingDirectory.error
          ? {
            status: "invalid-configuration" as const,
            statusLabel: resolvedWorkingDirectory.error.message,
          }
          : { status: "ready" as const, statusLabel: "" };
      },
    }).find((summary) => summary.id === options.profileId);
    if (!profileSummary || profileSummary.status !== "ready") {
      return {
        error: `${profile.label} is not available. ${profileSummary?.statusLabel ?? "Check the profile configuration in Manage Profiles or settings."}`,
        session: null,
      };
    }
    const resolvedWorkingDirectory = options.cwd
      ? { error: null, label: `Restored - ${options.cwd}`, path: options.cwd }
      : resolveAgentProfileWorkingDirectory(profile, this.workspaceRootPath, launchConfiguration.defaultWorkingDirectory);
    if (!resolvedWorkingDirectory.path) {
      return {
        error: `Unable to launch ${profile.label}. ${resolvedWorkingDirectory.error?.message ?? "Check the working directory configuration."}`,
        session: null,
      };
    }
    const contextPrompt = createOptions.skipInitialPrompt
      ? null
      : this.promptBuilder.buildContextPrompt({
        description: options.itemDescription,
        title: options.itemTitle,
      });
    let launchPlan;
    try {
      launchPlan = buildAgentLaunchPlan({
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
    const label = createOptions.existingLabel?.trim() || `${options.itemTitle} - ${profile.label}`;
    const terminal = vscode.window.createTerminal({
      cwd: resolvedWorkingDirectory.path,
      name: label,
      shellArgs: [...launchPlan.args],
      shellPath: launchPlan.executable,
    });
    const statusLabel = profile.usesContext
      ? (createOptions.skipInitialPrompt
        ? `${profileSummary.resumeBehaviorLabel} Resumed without replaying the context prompt.`
        : `${profileSummary.statusLabel}. Context prompt sent after launch.`)
      : profileSummary.resumeBehaviorLabel;
    const summary: TerminalSessionSummary = {
      activityState: "active",
      activityStateLabel: "Launching agent session",
      command: profile.command.trim(),
      id,
      itemDescription: options.itemDescription,
      itemId: options.itemId,
      itemTitle: options.itemTitle,
      kind: profile.kind,
      label,
      profileId: profile.id,
      profileLabel: profile.label,
      resumeSessionId: launchPlan.sessionId,
      statusLabel,
    };

    const persisted: PersistedTerminalSession = {
      command: summary.command,
      cwd: resolvedWorkingDirectory.path ?? null,
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

    this.sessionsById.set(id, {
      createdAt: Date.now(),
      hasObservedSignal: false,
      lastActivityAt: Date.now(),
      lastObservedTerminalName: label.trim(),
      persisted,
      summary,
      terminal,
    });
    if (createOptions.persist !== false) {
      await this.persistSession(persisted);
    }
    if (createOptions.emitChange !== false) {
      this.sessionsChangedEmitter.fire();
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
        this.markSessionActivity(id, { emitChange: true });
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
    this.recentlyClosedSessions = await this.persistence.loadRecentlyClosedSessions();
    const survivingTerminals = [...vscode.window.terminals];
    const matchedTerminals = new Set<vscode.Terminal>();
    const persistedLabelCounts = countLabels(sessions.map((session) => session.label));
    const survivingLabelCounts = countLabels(survivingTerminals.map((terminal) => terminal.name));
    let restoredCount = 0;
    let skippedCount = 0;

    for (const session of sessions) {
      const normalizedLabel = session.label.trim();
      const canAdoptByLabel = normalizedLabel.length > 0 &&
        (persistedLabelCounts.get(normalizedLabel) ?? 0) === 1 &&
        (survivingLabelCounts.get(normalizedLabel) ?? 0) === 1;
      const existingTerminal = canAdoptByLabel
        ? survivingTerminals.find((terminal) => {
          return !matchedTerminals.has(terminal) && terminal.name.trim() === normalizedLabel;
        })
        : undefined;
      if (existingTerminal) {
        matchedTerminals.add(existingTerminal);
        await this.restoreTrackedSession(session, existingTerminal);
        restoredCount += 1;
        continue;
      }

      if (session.kind === "shell") {
        const result = await this.createShellSession(
          session.itemId,
          session.itemTitle,
          session.itemDescription,
          session.cwd ?? undefined,
          {
            existingId: session.id,
            reveal: false,
          },
        );
        if (result.session) {
          restoredCount += 1;
        } else {
          skippedCount += 1;
        }
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
          existingLabel: session.label,
          resumeSessionId: session.resumeSessionId,
          skipInitialPrompt: shouldSkipInitialPromptOnRestore(session.profileId, session.resumeSessionId),
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

    const configuration = vscode.workspace.getConfiguration("workTerminal");
    const catalog = loadAgentProfileCatalog(configuration);
    const launchConfiguration = this.loadLaunchConfiguration(configuration);
    const agentProfiles = getAgentProfileSummaries(catalog.profiles, {
      getWorkingDirectoryLabel: (profile) => {
        return resolveAgentProfileWorkingDirectory(
          profile,
          this.workspaceRootPath,
          launchConfiguration.defaultWorkingDirectory,
        ).label;
      },
      getWorkingDirectoryStatus: (profile) => {
        const resolvedWorkingDirectory = resolveAgentProfileWorkingDirectory(
          profile,
          this.workspaceRootPath,
          launchConfiguration.defaultWorkingDirectory,
        );
        return resolvedWorkingDirectory.error
          ? {
            status: "invalid-configuration" as const,
            statusLabel: resolvedWorkingDirectory.error.message,
          }
          : { status: "ready" as const, statusLabel: "" };
      },
    });

    return {
      agentProfiles,
      configurationIssues: [
        ...catalog.issues,
        ...launchConfiguration.issues,
      ],
      launchConfiguration: {
        defaultWorkingDirectoryLabel: launchConfiguration.defaultWorkingDirectoryLabel,
        shellStatusLabel: launchConfiguration.shellStatusLabel,
      },
      recentlyClosedSessions: this.recentlyClosedSessions,
      sessionCountByItemId,
      sessions,
    };
  }

  public async reopenRecentlyClosedSession(id: string): Promise<{
    readonly error: string | null;
    readonly session: TerminalSessionSummary | null;
  }> {
    const recentlyClosed = this.recentlyClosedSessions.find((session) => session.id === id);
    if (!recentlyClosed) {
      return {
        error: "That recently closed session is no longer available.",
        session: null,
      };
    }

    if (recentlyClosed.kind === "shell") {
      const result = await this.createShellSession(
        recentlyClosed.itemId,
        recentlyClosed.itemTitle,
        recentlyClosed.itemDescription,
        recentlyClosed.cwd ?? undefined,
        {
          emitChange: false,
          existingId: recentlyClosed.id,
        },
      );
      if (!result.session) {
        return result;
      }
      await this.removeRecentlyClosedSession(id);
      this.sessionsChangedEmitter.fire();
      return result;
    }

    if (!recentlyClosed.profileId) {
      return {
        error: "That recently closed session can no longer be reopened.",
        session: null,
      };
    }

    const result = await this.createAgentSession(
      {
        cwd: recentlyClosed.cwd ?? undefined,
        itemDescription: recentlyClosed.itemDescription,
        itemId: recentlyClosed.itemId,
        itemTitle: recentlyClosed.itemTitle,
        profileId: recentlyClosed.profileId,
      },
      {
        emitChange: false,
        existingId: recentlyClosed.id,
        existingLabel: recentlyClosed.label,
        resumeSessionId: recentlyClosed.resumeSessionId,
      },
    );

    if (!result.session) {
      return result;
    }

    await this.removeRecentlyClosedSession(id);
    this.sessionsChangedEmitter.fire();
    return result;
  }

  public dispose(): void {
    this.closeDisposable.dispose();
    this.terminalStateDisposable.dispose();
    clearInterval(this.monitorInterval);
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

      const observedLabel = terminal.name.trim();
      const persistedSession = observedLabel
        ? {
            ...session.persisted,
            label: observedLabel,
          }
        : session.persisted;
      this.clearPendingInitialPrompt(id);
      this.sessionsById.delete(id);
      await this.recordClosedSession(persistedSession);
      this.sessionsChangedEmitter.fire();
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

  private handleTerminalStateChange(terminal: vscode.Terminal): void {
    if (!terminal.state.isInteractedWith) {
      return;
    }

    for (const [id, session] of this.sessionsById) {
      if (session.terminal === terminal) {
        this.markSessionActivity(id, { emitChange: true });
        return;
      }
    }
  }

  private async recordClosedSession(session: PersistedTerminalSession): Promise<void> {
    try {
      await this.persistence.recordClosedSession(session);
      await this.refreshRecentlyClosedSessions();
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }

      console.warn(
        `[work-terminal] Failed to record recently closed terminal session "${session.id}".`,
        error,
      );
    }
  }

  private async persistSession(session: PersistedTerminalSession): Promise<void> {
    try {
      await this.persistence.upsertSession(session);
      this.recentlyClosedSessions = this.recentlyClosedSessions.filter((entry) => entry.id !== session.id);
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

  private markSessionActivity(id: string, options: { readonly emitChange: boolean }): void {
    const session = this.sessionsById.get(id);
    if (!session || session.summary.kind === "shell") {
      return;
    }

    const nextSummary = this.withDerivedAgentState(
      {
        ...session,
        hasObservedSignal: true,
        lastActivityAt: Date.now(),
      },
      Date.now(),
    );
    this.sessionsById.set(id, nextSummary);
    if (options.emitChange) {
      this.sessionsChangedEmitter.fire();
    }
  }

  private async refreshRecentlyClosedSessions(): Promise<void> {
    this.recentlyClosedSessions = await this.persistence.loadRecentlyClosedSessions();
  }

  private async removeRecentlyClosedSession(id: string): Promise<void> {
    try {
      await this.persistence.removeRecentlyClosedSession(id);
      this.recentlyClosedSessions = this.recentlyClosedSessions.filter((session) => session.id !== id);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }

      console.warn(
        `[work-terminal] Failed to remove recently closed terminal session "${id}".`,
        error,
      );
    }
  }

  private loadLaunchConfiguration(
    configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("workTerminal"),
  ): TerminalLaunchConfigurationSummary {
    return loadTerminalLaunchConfiguration(configuration, this.workspaceRootPath);
  }

  private async refreshSessionTracking(): Promise<void> {
    const now = Date.now();
    let didChange = false;

    for (const [id, session] of this.sessionsById) {
      const renamedSession = await this.maybeApplyTerminalRename(id, session, now);
      const trackedSession = this.withDerivedAgentState(renamedSession, now);

      if (trackedSession !== renamedSession) {
        this.sessionsById.set(id, trackedSession);
        didChange = true;
        continue;
      }

      if (renamedSession !== session) {
        this.sessionsById.set(id, renamedSession);
        didChange = true;
      }
    }

    if (didChange) {
      this.sessionsChangedEmitter.fire();
    }
  }

  private queueRefreshSessionTracking(): void {
    if (this.refreshSessionTrackingPromise) {
      return;
    }

    this.refreshSessionTrackingPromise = this.refreshSessionTracking().finally(() => {
      this.refreshSessionTrackingPromise = null;
    });
  }

  private async maybeApplyTerminalRename(
    id: string,
    session: StoredTerminalSession,
    now: number,
  ): Promise<StoredTerminalSession> {
    if (session.summary.kind === "shell") {
      return session;
    }

    const observedName = session.terminal.name.trim();
    if (!observedName || observedName === session.lastObservedTerminalName) {
      return session;
    }

    const renamedSession = this.withDerivedAgentState(
      {
        ...session,
        hasObservedSignal: true,
        lastActivityAt: now,
        lastObservedTerminalName: observedName,
        persisted: {
          ...session.persisted,
          label: observedName,
        },
        summary: {
          ...session.summary,
          label: observedName,
        },
      },
      now,
    );

    await this.persistSession(renamedSession.persisted);
    return renamedSession;
  }

  private withDerivedAgentState(session: StoredTerminalSession, now: number): StoredTerminalSession {
    if (session.summary.kind === "shell") {
      return session;
    }

    const nextActivityState = deriveAgentActivityState(session, now);
    const nextActivityStateLabel = getAgentActivityStateLabel(nextActivityState, session.hasObservedSignal);

    if (
      session.summary.activityState === nextActivityState &&
      session.summary.activityStateLabel === nextActivityStateLabel
    ) {
      return session;
    }

    return {
      ...session,
      summary: {
        ...session.summary,
        activityState: nextActivityState,
        activityStateLabel: nextActivityStateLabel,
      },
    };
  }

  private async restoreTrackedSession(session: PersistedTerminalSession, terminal: vscode.Terminal): Promise<void> {
    const observedLabel = terminal.name.trim() || session.label;
    const now = Date.now();

    const storedSession = this.withDerivedAgentState({
      createdAt: now - AGENT_ACTIVE_WINDOW_MS,
      hasObservedSignal: terminal.state.isInteractedWith,
      lastActivityAt: terminal.state.isInteractedWith ? now : now - AGENT_ACTIVE_WINDOW_MS,
      lastObservedTerminalName: observedLabel,
      persisted: {
        ...session,
        label: observedLabel,
      },
      summary: {
        activityState: session.kind === "shell" ? null : "waiting",
        activityStateLabel: session.kind === "shell" ? null : "Waiting for detectable terminal signals",
        command: session.command,
        id: session.id,
        itemDescription: session.itemDescription,
        itemId: session.itemId,
        itemTitle: session.itemTitle,
        kind: session.kind,
        label: observedLabel,
        profileId: session.profileId,
        profileLabel: session.profileLabel,
        resumeSessionId: session.resumeSessionId,
        statusLabel: session.statusLabel,
      },
      terminal,
    }, now);

    this.sessionsById.set(session.id, storedSession);
    if (observedLabel !== session.label) {
      await this.persistSession(storedSession.persisted);
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

function buildConfigurationErrorMessage(
  prefix: string,
  launchConfiguration: TerminalLaunchConfigurationSummary,
  relevantSettings: readonly string[],
): string {
  const matchingIssue = launchConfiguration.issues.find((issue) => relevantSettings.includes(issue.settingPath));
  if (!matchingIssue) {
    return prefix;
  }

  return `${prefix} ${matchingIssue.message} (${matchingIssue.settingPath})`;
}

function deriveAgentActivityState(session: StoredTerminalSession, now: number): AgentActivityState {
  if (now - session.createdAt < AGENT_ACTIVE_WINDOW_MS) {
    return "active";
  }

  if (now - session.lastActivityAt >= AGENT_IDLE_AFTER_MS) {
    return "idle";
  }

  return session.hasObservedSignal ? "active" : "waiting";
}

function getAgentActivityStateLabel(state: AgentActivityState, hasObservedSignal: boolean): string {
  switch (state) {
    case "active":
      return hasObservedSignal ? "Recent terminal signal observed" : "Starting agent session";
    case "idle":
      return "No recent terminal signals observed";
    case "waiting":
      return "Waiting for detectable terminal signals";
  }
}

function shouldSkipInitialPromptOnRestore(
  profileId: AgentProfileId | null,
  resumeSessionId: string | null,
): boolean {
  if (!profileId || !resumeSessionId?.trim()) {
    return false;
  }

  const profile = loadAgentProfileCatalog(vscode.workspace.getConfiguration("workTerminal")).profiles
    .find((candidate) => candidate.id === profileId);
  return Boolean(profile && profile.kind === "claude" && profile.usesContext);
}

function countLabels(labels: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) {
      continue;
    }

    counts.set(normalizedLabel, (counts.get(normalizedLabel) ?? 0) + 1);
  }

  return counts;
}
