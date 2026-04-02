import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type RecentlyClosedTerminalSession,
  TerminalSessionPersistence,
  type PersistedTerminalSession,
} from "../../src/terminals/TerminalSessionPersistence";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("TerminalSessionPersistence", () => {
  it("saves and reloads persisted sessions", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const session = createPersistedSession({
      id: "session-1",
      itemTitle: "Investigate flaky persistence test",
    });

    await persistence.upsertSession(session);

    const reloaded = new TerminalSessionPersistence(workspaceRoot);
    const sessions = await reloaded.loadSessions();
    const snapshotPath = reloaded.getStoragePath();

    expect(sessions).toEqual([session]);
    expect(snapshotPath).toContain(".work-terminal/terminal-sessions.v1.json");
    expect(await readFile(snapshotPath!, "utf8")).toContain("Investigate flaky persistence test");
  });

  it("removes closed sessions from the persisted snapshot", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    await persistence.upsertSession(createPersistedSession({ id: "session-1" }));
    await persistence.upsertSession(createPersistedSession({ id: "session-2", itemTitle: "Second session" }));

    await persistence.deleteSession("session-1");

    const sessions = await persistence.loadSessions();
    expect(sessions.map((session) => session.id)).toEqual(["session-2"]);
  });

  it("records recently closed sessions separately from active sessions", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const session = createPersistedSession({ id: "session-1" });

    await persistence.upsertSession(session);
    await persistence.recordClosedSession(session);

    expect(await persistence.loadSessions()).toEqual([]);
    expect(await persistence.loadRecentlyClosedSessions()).toEqual([
      expect.objectContaining({
        closedAt: expect.any(String),
        id: "session-1",
      }),
    ]);
  });

  it("prunes stale or excessive recently closed sessions on load", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const snapshotPath = persistence.getStoragePath();
    const now = Date.now();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, JSON.stringify({
      recentlyClosedSessions: [
        createRecentlyClosedSession({ id: "fresh-1", closedAt: new Date(now).toISOString() }),
        createRecentlyClosedSession({ id: "fresh-2", closedAt: new Date(now - 1_000).toISOString() }),
        createRecentlyClosedSession({ id: "stale", closedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }),
        ...Array.from({ length: 12 }, (_, index) =>
          createRecentlyClosedSession({
            id: `overflow-${index}`,
            closedAt: new Date(now - (index + 2) * 1_000).toISOString(),
          })),
      ],
      sessions: [],
      version: 1,
    }, null, 2), "utf8");

    const recentlyClosedSessions = await persistence.loadRecentlyClosedSessions();

    expect(recentlyClosedSessions.some((session) => session.id === "stale")).toBe(false);
    expect(recentlyClosedSessions).toHaveLength(12);
  });

  it("backs up corrupt snapshots before saving new session metadata", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, "{ not valid json\n", "utf8");

    await persistence.upsertSession(createPersistedSession({ id: "session-1" }));

    const files = await readdir(join(workspaceRoot, ".work-terminal"));
    expect(files.some((file) => file.startsWith("terminal-sessions.v1.json.corrupt-"))).toBe(true);
  });

  it("backs up corrupt snapshots before loading sessions", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, "{ not valid json\n", "utf8");

    await expect(persistence.loadSessions()).resolves.toEqual([]);

    const files = await readdir(join(workspaceRoot, ".work-terminal"));
    expect(files.some((file) => file.startsWith("terminal-sessions.v1.json.corrupt-"))).toBe(true);
  });

  it("resets to an empty snapshot when backing up a corrupt snapshot races with another read", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, "{ not valid json\n", "utf8");

    Object.assign(persistence as unknown as {
      backupCorruptSnapshot: (storagePath: string) => Promise<void>;
    }, {
      backupCorruptSnapshot: async () => {
        const error = new Error("already moved") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });

    try {
      await expect(persistence.loadSessions()).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("already moved or removed"),
        expect.objectContaining({ code: "ENOENT" }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  }, 10_000);

  it("logs the underlying corruption cause when resetting a corrupt snapshot", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, "{ not valid json\n", "utf8");

    try {
      await expect(persistence.loadSessions()).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("was corrupt"),
        expect.any(SyntaxError),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rethrows unexpected backup failures after logging them", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, "{ not valid json\n", "utf8");

    Object.assign(persistence as unknown as {
      backupCorruptSnapshot: (storagePath: string) => Promise<void>;
    }, {
      backupCorruptSnapshot: async () => {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      },
    });

    try {
      await expect(persistence.loadSessions()).rejects.toMatchObject({ code: "EACCES" });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unable to reset the terminal session store safely"),
        expect.objectContaining({ code: "EACCES" }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("backs up snapshots with unsupported versions before loading sessions", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, JSON.stringify({
      recentlyClosedSessions: [],
      sessions: [],
      version: 99,
    }, null, 2), "utf8");

    await expect(persistence.loadSessions()).resolves.toEqual([]);

    const files = await readdir(join(workspaceRoot, ".work-terminal"));
    expect(files.some((file) => file.startsWith("terminal-sessions.v1.json.corrupt-"))).toBe(true);
  });

  it("backs up snapshots with malformed persisted sessions before loading sessions", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, JSON.stringify({
      recentlyClosedSessions: [],
      sessions: [
        {
          itemId: "item-1",
          itemTitle: "Investigate regression",
          kind: "shell",
          label: "Investigate regression - Shell",
          statusLabel: "Local shell session",
        },
      ],
      version: 1,
    }, null, 2), "utf8");

    await expect(persistence.loadSessions()).resolves.toEqual([]);

    const files = await readdir(join(workspaceRoot, ".work-terminal"));
    expect(files.some((file) => file.startsWith("terminal-sessions.v1.json.corrupt-"))).toBe(true);
  });

  it("backs up snapshots with malformed recently closed sessions before loading them", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, JSON.stringify({
      recentlyClosedSessions: [
        {
          ...createPersistedSession({ id: "session-1" }),
        },
      ],
      sessions: [],
      version: 1,
    }, null, 2), "utf8");

    await expect(persistence.loadRecentlyClosedSessions()).resolves.toEqual([]);

    const files = await readdir(join(workspaceRoot, ".work-terminal"));
    expect(files.some((file) => file.startsWith("terminal-sessions.v1.json.corrupt-"))).toBe(true);
  });

  it("trims persisted profile ids when reloading sessions", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, JSON.stringify({
      recentlyClosedSessions: [],
      sessions: [
        createPersistedSession({
          id: "session-1",
          kind: "claude",
          profileId: " claude-context ",
          profileLabel: "Claude (ctx)",
        }),
      ],
      version: 1,
    }, null, 2), "utf8");

    await expect(persistence.loadSessions()).resolves.toEqual([
      expect.objectContaining({
        id: "session-1",
        profileId: "claude-context",
      }),
    ]);
  });

  it("backs up snapshots with invalid recently closed timestamps before loading them", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-session-persistence-"));
    tempDirectories.push(workspaceRoot);

    const persistence = new TerminalSessionPersistence(workspaceRoot);
    const snapshotPath = persistence.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, JSON.stringify({
      recentlyClosedSessions: [
        createRecentlyClosedSession({
          closedAt: "not-a-date",
          id: "session-1",
        }),
      ],
      sessions: [],
      version: 1,
    }, null, 2), "utf8");

    await expect(persistence.loadRecentlyClosedSessions()).resolves.toEqual([]);

    const files = await readdir(join(workspaceRoot, ".work-terminal"));
    expect(files.some((file) => file.startsWith("terminal-sessions.v1.json.corrupt-"))).toBe(true);
  }, 10_000);
});

function createPersistedSession(overrides: Partial<PersistedTerminalSession> = {}): PersistedTerminalSession {
  return {
    command: null,
    cwd: "/workspace",
    id: "session-default",
    itemDescription: "Look into the regression",
    itemId: "item-1",
    itemTitle: "Investigate regression",
    kind: "shell",
    label: "Investigate regression - Shell",
    profileId: null,
    profileLabel: null,
    resumeSessionId: null,
    statusLabel: "Local shell session",
    ...overrides,
  };
}

function createRecentlyClosedSession(
  overrides: Partial<RecentlyClosedTerminalSession> = {},
): RecentlyClosedTerminalSession {
  return {
    ...createPersistedSession(overrides),
    closedAt: new Date().toISOString(),
    ...overrides,
  };
}
