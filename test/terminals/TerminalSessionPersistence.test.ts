import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

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
  });
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
