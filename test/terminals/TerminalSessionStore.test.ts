import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfigurationValues = Record<string, string>;

interface MockTerminal {
  dispose: ReturnType<typeof vi.fn>;
  name: string;
  sendText: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  state: {
    isInteractedWith: boolean;
  };
}

const configurationValues: ConfigurationValues = {
  claudeCommand: "claude",
  claudeExtraArgs: "",
  copilotCommand: "copilot",
  copilotExtraArgs: "",
};

const createdTerminals: MockTerminal[] = [];
const openTerminals: MockTerminal[] = [];
const createdTerminalOptions: unknown[] = [];
const closeListeners: Array<(terminal: MockTerminal) => void> = [];
const terminalStateListeners: Array<(terminal: MockTerminal) => void> = [];
const tempDirectories: string[] = [];

vi.mock("vscode", () => {
  class Disposable {
    public constructor(private readonly callback: () => void) {}

    public dispose(): void {
      this.callback();
    }
  }

  class EventEmitter<T> {
    private readonly listeners = new Set<(value: T) => void>();

    public get event(): (listener: (value: T) => void) => Disposable {
      return (listener) => {
        this.listeners.add(listener);
        return new Disposable(() => {
          this.listeners.delete(listener);
        });
      };
    }

    public fire(value: T): void {
      for (const listener of this.listeners) {
        listener(value);
      }
    }

    public dispose(): void {
      this.listeners.clear();
    }
  }

  return {
    Disposable,
    EventEmitter,
    window: {
      createTerminal: vi.fn((options: unknown) => {
        const terminal: MockTerminal = {
          dispose: vi.fn(),
          name: (options as { name?: string } | undefined)?.name ?? "Terminal",
          sendText: vi.fn(),
          show: vi.fn(),
          state: {
            isInteractedWith: false,
          },
        };
        createdTerminals.push(terminal);
        openTerminals.push(terminal);
        createdTerminalOptions.push(options);
        return terminal;
      }),
      get terminals() {
        return openTerminals;
      },
      onDidCloseTerminal: vi.fn((listener: (terminal: MockTerminal) => void) => {
        closeListeners.push(listener);
        return new Disposable(() => {
          const index = closeListeners.indexOf(listener);
          if (index >= 0) {
            closeListeners.splice(index, 1);
          }
        });
      }),
      onDidChangeTerminalState: vi.fn((listener: (terminal: MockTerminal) => void) => {
        terminalStateListeners.push(listener);
        return new Disposable(() => {
          const index = terminalStateListeners.indexOf(listener);
          if (index >= 0) {
            terminalStateListeners.splice(index, 1);
          }
        });
      }),
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: <T>(section: string, defaultValue?: T) =>
          ((configurationValues[section] as T | undefined) ?? defaultValue) as T,
      })),
    },
  };
});

describe("TerminalSessionStore", () => {
  beforeEach(() => {
    createdTerminals.length = 0;
    openTerminals.length = 0;
    createdTerminalOptions.length = 0;
    closeListeners.length = 0;
    terminalStateListeners.length = 0;
    configurationValues.claudeCommand = "claude";
    configurationValues.claudeExtraArgs = "";
    configurationValues.copilotCommand = "copilot";
    configurationValues.copilotExtraArgs = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it("creates shell sessions and counts them by work item", async () => {
    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const session = await store.createShellSession("item-1", "Demo item", null, "/workspace");
    const summary = store.getSummary();

    expect(session.kind).toBe("shell");
    expect(summary.sessionCountByItemId["item-1"]).toBe(1);
    expect(createdTerminals).toHaveLength(1);
    expect(createdTerminals[0].show).toHaveBeenCalledWith(true);

    store.dispose();
  });

  it("creates agent sessions and sends context prompts after launch", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude-context",
    });

    expect(result.error).toBeNull();
    expect(result.session?.profileId).toBe("claude-context");
    expect(result.session?.resumeSessionId).toMatch(/[0-9a-f-]{36}/);
    expect(result.session?.activityState).toBe("active");

    await vi.advanceTimersByTimeAsync(250);

    expect(createdTerminals[0].sendText).toHaveBeenCalledWith(
      expect.stringContaining("Work item context:"),
      true,
    );

    store.dispose();
  });

  it("does not send a delayed prompt after the terminal has already closed", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude-context",
    });

    expect(result.error).toBeNull();

    closeListeners[0]?.(createdTerminals[0]);
    await vi.advanceTimersByTimeAsync(250);
    await waitForPersistedSessionCount(store, 0);

    expect(createdTerminals[0].sendText).not.toHaveBeenCalled();

    store.dispose();
  });

  it("reports missing commands for unavailable profiles", async () => {
    configurationValues.claudeCommand = "definitely-missing-command-for-test";

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: null,
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude",
    });

    expect(result.session).toBeNull();
    expect(result.error).toContain("Claude is not available");

    store.dispose();
  });

  it("emits session change events on create and close", async () => {
    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);
    const onChange = vi.fn();
    const disposable = store.onDidChangeSessions(onChange);

    await store.createShellSession("item-1", "Demo item", null, "/workspace");
    expect(onChange).toHaveBeenCalledTimes(1);

    closeListeners[0]?.(createdTerminals[0]);
    await waitForPersistedSessionCount(store, 0);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(store.getSummary().sessions).toHaveLength(0);
    expect(store.getSummary().recentlyClosedSessions).toHaveLength(1);

    disposable.dispose();
    store.dispose();
  });

  it("keeps terminals open when the store is disposed so recovery metadata survives shutdown", async () => {
    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    await store.createShellSession("item-1", "Demo item", null, "/workspace");
    store.dispose();

    expect(createdTerminals[0].dispose).not.toHaveBeenCalled();
  });

  it("restores persisted Claude sessions with the same resume session id", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude-context",
    });

    expect(result.error).toBeNull();
    const originalResumeSessionId = result.session?.resumeSessionId;
    const snapshotPath = store.getStoragePath();
    store.dispose();
    openTerminals.length = 0;

    const restoredStore = new TerminalSessionStore(workspaceRoot);
    const recovery = await restoredStore.restorePersistedSessions();
    const restoredSummary = restoredStore.getSummary();
    const persistedContent = await readFile(snapshotPath!, "utf8");

    expect(recovery.restoredCount).toBe(1);
    expect(recovery.skippedCount).toBe(0);
    expect(restoredSummary.sessions[0]?.resumeSessionId).toBe(originalResumeSessionId);
    expect(createdTerminals[1].show).not.toHaveBeenCalled();
    expect(createdTerminalOptions[1]).toMatchObject({
      cwd: "/workspace",
      shellArgs: expect.arrayContaining(["--session-id", originalResumeSessionId]),
      shellPath: process.execPath,
    });
    expect(persistedContent).toContain(originalResumeSessionId);

    restoredStore.dispose();
  });

  it("reconciles already open terminals during recovery instead of relaunching duplicates", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude",
    });

    expect(result.error).toBeNull();
    createdTerminals[0].show.mockClear();
    store.dispose();

    const restoredStore = new TerminalSessionStore(workspaceRoot);
    const recovery = await restoredStore.restorePersistedSessions();
    const restoredSummary = restoredStore.getSummary();

    expect(recovery.restoredCount).toBe(1);
    expect(recovery.skippedCount).toBe(0);
    expect(createdTerminals).toHaveLength(1);
    expect(createdTerminalOptions).toHaveLength(1);
    expect(createdTerminals[0].show).not.toHaveBeenCalled();
    expect(restoredSummary.sessions).toHaveLength(1);
    expect(restoredSummary.sessions[0]?.id).toBe(result.session?.id);

    restoredStore.dispose();
  });

  it("does not replay the delayed context prompt when restoring a resumed context session", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude-context",
    });

    expect(result.error).toBeNull();
    const originalResumeSessionId = result.session?.resumeSessionId;

    await vi.advanceTimersByTimeAsync(250);
    expect(createdTerminals[0].sendText).toHaveBeenCalledWith(
      expect.stringContaining("Work item context:"),
      true,
    );

    store.dispose();
    openTerminals.length = 0;

    const restoredStore = new TerminalSessionStore(workspaceRoot);
    const recovery = await restoredStore.restorePersistedSessions();

    expect(recovery.restoredCount).toBe(1);
    expect(createdTerminals).toHaveLength(2);
    expect(createdTerminalOptions[1]).toMatchObject({
      shellArgs: expect.arrayContaining(["--session-id", originalResumeSessionId]),
      shellPath: process.execPath,
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(createdTerminals[1].sendText).not.toHaveBeenCalled();
    expect(restoredStore.getSummary().sessions[0]?.statusLabel).toBe(
      "Tracks a launch session id and sends work item context after launch. Resumed without replaying the context prompt.",
    );

    restoredStore.dispose();
  });

  it("does not auto-adopt surviving terminals when persisted labels are ambiguous", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const first = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "First task",
      itemId: "item-1",
      itemTitle: "Shared title",
      profileId: "claude",
    });
    const second = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Second task",
      itemId: "item-2",
      itemTitle: "Shared title",
      profileId: "claude",
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    store.dispose();

    openTerminals.splice(1);

    const restoredStore = new TerminalSessionStore(workspaceRoot);
    const recovery = await restoredStore.restorePersistedSessions();

    expect(recovery.restoredCount).toBe(2);
    expect(recovery.skippedCount).toBe(0);
    expect(createdTerminals).toHaveLength(4);
    expect(restoredStore.getSummary().sessions).toHaveLength(2);

    restoredStore.dispose();
  });

  it("replays the delayed context prompt when restoring non-resumable context sessions", async () => {
    configurationValues.copilotCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "copilot-context",
    });

    expect(result.error).toBeNull();
    await vi.advanceTimersByTimeAsync(250);
    expect(createdTerminals[0].sendText).toHaveBeenCalledWith(
      expect.stringContaining("Work item context:"),
      true,
    );

    store.dispose();
    openTerminals.length = 0;

    const restoredStore = new TerminalSessionStore(workspaceRoot);
    const recovery = await restoredStore.restorePersistedSessions();

    expect(recovery.restoredCount).toBe(1);
    expect(createdTerminals).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(createdTerminals[1].sendText).toHaveBeenCalledWith(
      expect.stringContaining("Work item context:"),
      true,
    );
    expect(restoredStore.getSummary().sessions[0]?.statusLabel).toContain("Context prompt sent after launch");

    restoredStore.dispose();
  });

  it("reopens recently closed shell sessions", async () => {
    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const session = await store.createShellSession("item-1", "Demo item", null, "/workspace");
    closeListeners[0]?.(createdTerminals[0]);
    await waitForPersistedSessionCount(store, 0);
    await vi.waitFor(() => {
      expect(store.getSummary().recentlyClosedSessions).toHaveLength(1);
    });

    const reopened = await store.reopenRecentlyClosedSession(session.id);

    expect(reopened.error).toBeNull();
    expect(reopened.session?.id).toBe(session.id);
    expect(store.getSummary().recentlyClosedSessions).toHaveLength(0);
    expect(store.getSummary().sessions).toHaveLength(1);
    expect(createdTerminals[1].show).toHaveBeenCalledWith(true);

    store.dispose();
  });

  it("reopens recently closed Claude sessions with the same resume session id", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude-context",
    });
    const originalResumeSessionId = result.session?.resumeSessionId;

    closeListeners[0]?.(createdTerminals[0]);
    await waitForPersistedSessionCount(store, 0);
    await vi.waitFor(() => {
      expect(store.getSummary().recentlyClosedSessions).toHaveLength(1);
    });

    const reopened = await store.reopenRecentlyClosedSession(result.session!.id);

    expect(reopened.error).toBeNull();
    expect(reopened.session?.resumeSessionId).toBe(originalResumeSessionId);
    expect(createdTerminalOptions[1]).toMatchObject({
      shellArgs: expect.arrayContaining(["--session-id", originalResumeSessionId]),
      shellPath: process.execPath,
    });

    store.dispose();
  });

  it("transitions agent sessions from active to waiting to idle based on observable terminal signals", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude",
    });

    expect(store.getSummary().sessions[0]?.activityState).toBe("active");

    await vi.advanceTimersByTimeAsync(16_000);
    expect(store.getSummary().sessions[0]?.activityState).toBe("waiting");

    createdTerminals[0].state.isInteractedWith = true;
    terminalStateListeners[0]?.(createdTerminals[0]);
    expect(store.getSummary().sessions[0]?.activityState).toBe("active");

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1_000);
    expect(store.getSummary().sessions[0]?.activityState).toBe("idle");

    store.dispose();
  });

  it("tracks agent session renames when VS Code updates the terminal title", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude",
    });

    createdTerminals[0].name = "Investigate regression - Claude renamed";
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => {
      expect(store.getSummary().sessions[0]?.label).toBe("Investigate regression - Claude renamed");
    });

    store.dispose();
  });

  it("preserves renamed agent labels when restoring persisted sessions", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude",
    });

    createdTerminals[0].name = "Investigate regression - Claude renamed";
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => {
      expect(store.getSummary().sessions[0]?.label).toBe("Investigate regression - Claude renamed");
    });
    store.dispose();
    openTerminals.length = 0;

    const restoredStore = new TerminalSessionStore(workspaceRoot);
    await restoredStore.restorePersistedSessions();

    expect(restoredStore.getSummary().sessions[0]?.label).toBe("Investigate regression - Claude renamed");
    expect(createdTerminalOptions[1]).toMatchObject({
      name: "Investigate regression - Claude renamed",
    });

    restoredStore.dispose();
  });

  it("preserves renamed agent labels when reopening recently closed sessions", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude",
    });

    createdTerminals[0].name = "Investigate regression - Claude renamed";
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => {
      expect(store.getSummary().sessions[0]?.label).toBe("Investigate regression - Claude renamed");
    });
    closeListeners[0]?.(createdTerminals[0]);
    await waitForPersistedSessionCount(store, 0);

    const reopened = await store.reopenRecentlyClosedSession(result.session!.id);

    expect(reopened.session?.label).toBe("Investigate regression - Claude renamed");
    expect(createdTerminalOptions[1]).toMatchObject({
      name: "Investigate regression - Claude renamed",
    });

    store.dispose();
  });

  it("does not mark agent sessions active when they are only refocused from the board", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-terminal-store-"));
    tempDirectories.push(workspaceRoot);
    const store = new TerminalSessionStore(workspaceRoot);

    const result = await store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude",
    });

    await vi.advanceTimersByTimeAsync(16_000);
    expect(store.getSummary().sessions[0]?.activityState).toBe("waiting");

    expect(store.focusSession(result.session!.id)).toBe(true);
    expect(store.getSummary().sessions[0]?.activityState).toBe("waiting");

    store.dispose();
  });
});

async function waitForPersistedSessionCount(store: { getStoragePath(): string | null }, expectedCount: number): Promise<void> {
  const snapshotPath = store.getStoragePath();

  await vi.waitFor(async () => {
    const content = await readFile(snapshotPath!, "utf8");
    const parsed = JSON.parse(content) as { sessions?: unknown[] };
    expect(parsed.sessions).toHaveLength(expectedCount);
  });
}
