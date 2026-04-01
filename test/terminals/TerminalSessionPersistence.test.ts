import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
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
