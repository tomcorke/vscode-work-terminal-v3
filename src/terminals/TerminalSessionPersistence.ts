import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentProfileId } from "../agents";

const STORAGE_DIRECTORY_NAME = ".work-terminal";
const STORAGE_FILE_NAME = "terminal-sessions.v1.json";
const SNAPSHOT_VERSION = 1;
const MAX_RECENTLY_CLOSED_SESSIONS = 12;
const RECENTLY_CLOSED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type PersistedTerminalSessionKind = "claude" | "copilot" | "shell";

export interface PersistedTerminalSession {
  readonly command: string | null;
  readonly cwd: string | null;
  readonly id: string;
  readonly itemDescription: string | null;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly kind: PersistedTerminalSessionKind;
  readonly label: string;
  readonly profileId: AgentProfileId | null;
  readonly profileLabel: string | null;
  readonly resumeSessionId: string | null;
  readonly statusLabel: string;
}

export interface RecentlyClosedTerminalSession extends PersistedTerminalSession {
  readonly closedAt: string;
}

interface PersistedTerminalSnapshot {
  readonly recentlyClosedSessions: readonly RecentlyClosedTerminalSession[];
  readonly sessions: readonly PersistedTerminalSession[];
  readonly version: typeof SNAPSHOT_VERSION;
}

export class TerminalSessionPersistence {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly workspaceRootPath: string | null) {}

  public getStoragePath(): string | null {
    if (!this.workspaceRootPath) {
      return null;
    }

    return join(this.workspaceRootPath, STORAGE_DIRECTORY_NAME, STORAGE_FILE_NAME);
  }

  public async loadSessions(): Promise<readonly PersistedTerminalSession[]> {
    const snapshot = await this.loadSnapshotForRead();
    return snapshot.sessions;
  }

  public async loadRecentlyClosedSessions(): Promise<readonly RecentlyClosedTerminalSession[]> {
    const snapshot = await this.loadSnapshotForRead();
    return snapshot.recentlyClosedSessions;
  }

  public async deleteSession(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const nextSnapshot: PersistedTerminalSnapshot = {
        ...snapshot,
        sessions: snapshot.sessions.filter((session) => session.id !== id),
      };

      await this.saveSnapshot(nextSnapshot);
    });
  }

  public async recordClosedSession(session: PersistedTerminalSession): Promise<void> {
    await this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const nextSnapshot: PersistedTerminalSnapshot = {
        ...snapshot,
        recentlyClosedSessions: pruneRecentlyClosedSessions([
          {
            ...session,
            closedAt: new Date().toISOString(),
          },
          ...snapshot.recentlyClosedSessions.filter((entry) => entry.id !== session.id),
        ]),
        sessions: snapshot.sessions.filter((entry) => entry.id !== session.id),
      };

      await this.saveSnapshot(nextSnapshot);
    });
  }

  public async removeRecentlyClosedSession(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const nextSnapshot: PersistedTerminalSnapshot = {
        ...snapshot,
        recentlyClosedSessions: snapshot.recentlyClosedSessions.filter((session) => session.id !== id),
      };

      await this.saveSnapshot(nextSnapshot);
    });
  }

  public async upsertSession(session: PersistedTerminalSession): Promise<void> {
    await this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const nextSnapshot: PersistedTerminalSnapshot = {
        ...snapshot,
        recentlyClosedSessions: snapshot.recentlyClosedSessions.filter((entry) => entry.id !== session.id),
        sessions: [...snapshot.sessions.filter((entry) => entry.id !== session.id), session],
      };

      await this.saveSnapshot(nextSnapshot);
    });
  }

  private async loadSnapshot(): Promise<PersistedTerminalSnapshot> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return createEmptyPersistedTerminalSnapshot();
    }

    const content = await readFile(storagePath, "utf8");

    try {
      const parsed = JSON.parse(content) as unknown;
      return normalizePersistedTerminalSnapshot(parsed);
    } catch (error) {
      throw new CorruptSnapshotError(storagePath, error);
    }
  }

  private async loadSnapshotForRead(): Promise<PersistedTerminalSnapshot> {
    try {
      return await this.loadSnapshot();
    } catch (error) {
      if (error instanceof CorruptSnapshotError) {
        console.warn(
          `[work-terminal] Snapshot at ${error.storagePath} was corrupt. Backing it up and resetting the terminal session store.`,
        );
        await this.backupCorruptSnapshot(error.storagePath);
        return createEmptyPersistedTerminalSnapshot();
      }

      if (isMissingFileError(error)) {
        return createEmptyPersistedTerminalSnapshot();
      }

      throw error;
    }
  }

  private async loadSnapshotForWrite(): Promise<PersistedTerminalSnapshot> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return createEmptyPersistedTerminalSnapshot();
    }

    try {
      return await this.loadSnapshot();
    } catch (error) {
      if (error instanceof CorruptSnapshotError) {
        console.warn(
          `[work-terminal] Snapshot at ${error.storagePath} was corrupt. Backing it up and resetting the terminal session store.`,
        );
        await this.backupCorruptSnapshot(error.storagePath);
        return createEmptyPersistedTerminalSnapshot();
      }

      if (!isMissingFileError(error)) {
        throw error;
      }

      return createEmptyPersistedTerminalSnapshot();
    }
  }

  private async saveSnapshot(snapshot: PersistedTerminalSnapshot): Promise<void> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return;
    }

    await mkdir(dirname(storagePath), { recursive: true });
    const temporaryPath = `${storagePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temporaryPath, storagePath);
  }

  private async backupCorruptSnapshot(storagePath: string): Promise<void> {
    const backupPath = `${storagePath}.corrupt-${Date.now()}`;
    await rename(storagePath, backupPath);
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function createEmptyPersistedTerminalSnapshot(): PersistedTerminalSnapshot {
  return {
    recentlyClosedSessions: [],
    sessions: [],
    version: SNAPSHOT_VERSION,
  };
}

function normalizePersistedTerminalSnapshot(input: unknown): PersistedTerminalSnapshot {
  if (!isRecord(input)) {
    throw new TypeError("Terminal session snapshot must be an object.");
  }

  if (input.version !== SNAPSHOT_VERSION) {
    throw new TypeError(`Unsupported terminal session snapshot version: ${String(input.version)}`);
  }

  if (!Array.isArray(input.recentlyClosedSessions)) {
    throw new TypeError("Terminal session snapshot recently closed sessions must be an array.");
  }

  if (!Array.isArray(input.sessions)) {
    throw new TypeError("Terminal session snapshot sessions must be an array.");
  }

  const recentlyClosedSessions = pruneRecentlyClosedSessions(
    input.recentlyClosedSessions.map((session, index) => {
      const normalized = normalizeRecentlyClosedTerminalSession(session);
      if (!normalized) {
        throw new TypeError(`Invalid recently closed terminal session at index ${index}.`);
      }
      return normalized;
    }),
  );
  const sessions = input.sessions.map((session, index) => {
    const normalized = normalizePersistedTerminalSession(session);
    if (!normalized) {
      throw new TypeError(`Invalid terminal session at index ${index}.`);
    }
    return normalized;
  });

  return {
    recentlyClosedSessions,
    sessions,
    version: SNAPSHOT_VERSION,
  };
}

function normalizePersistedTerminalSession(input: unknown): PersistedTerminalSession | null {
  if (!isRecord(input)) {
    return null;
  }

  const id = asNonEmptyString(input.id);
  const itemId = asNonEmptyString(input.itemId);
  const itemTitle = asNonEmptyString(input.itemTitle);
  const kind = asSessionKind(input.kind);
  const label = asNonEmptyString(input.label);
  const statusLabel = asNonEmptyString(input.statusLabel);

  if (!id || !itemId || !itemTitle || !kind || !label || !statusLabel) {
    return null;
  }

  return {
    command: asNullableString(input.command),
    cwd: asNullableString(input.cwd),
    id,
    itemDescription: asNullableString(input.itemDescription),
    itemId,
    itemTitle,
    kind,
    label,
    profileId: asAgentProfileId(input.profileId),
    profileLabel: asNullableString(input.profileLabel),
    resumeSessionId: asNullableString(input.resumeSessionId),
    statusLabel,
  };
}

function normalizeRecentlyClosedTerminalSession(input: unknown): RecentlyClosedTerminalSession | null {
  const session = normalizePersistedTerminalSession(input);
  if (!session || !isRecord(input)) {
    return null;
  }

  const closedAt = asNonEmptyString(input.closedAt);
  if (!closedAt || !Number.isFinite(Date.parse(closedAt))) {
    return null;
  }

  return {
    ...session,
    closedAt,
  };
}

function asAgentProfileId(value: unknown): AgentProfileId | null {
  return value === "claude" ||
      value === "claude-context" ||
      value === "copilot" ||
      value === "copilot-context"
    ? value
    : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asSessionKind(value: unknown): PersistedTerminalSessionKind | null {
  return value === "claude" || value === "copilot" || value === "shell" ? value : null;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pruneRecentlyClosedSessions(
  sessions: readonly RecentlyClosedTerminalSession[],
): readonly RecentlyClosedTerminalSession[] {
  const cutoff = Date.now() - RECENTLY_CLOSED_MAX_AGE_MS;

  return [...sessions]
    .filter((session) => Date.parse(session.closedAt) >= cutoff)
    .sort((left, right) => right.closedAt.localeCompare(left.closedAt))
    .slice(0, MAX_RECENTLY_CLOSED_SESSIONS);
}

class CorruptSnapshotError extends Error {
  public constructor(
    public readonly storagePath: string,
    cause: unknown,
  ) {
    super(`Terminal session snapshot is corrupt: ${storagePath}`, { cause });
    this.name = "CorruptSnapshotError";
  }
}
