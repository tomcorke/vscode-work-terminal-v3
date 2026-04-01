import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentProfileId } from "../agents";

const STORAGE_DIRECTORY_NAME = ".work-terminal";
const STORAGE_FILE_NAME = "terminal-sessions.v1.json";
const SNAPSHOT_VERSION = 1;

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

interface PersistedTerminalSnapshot {
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

  public async upsertSession(session: PersistedTerminalSession): Promise<void> {
    await this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const nextSnapshot: PersistedTerminalSnapshot = {
        ...snapshot,
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
      if (isMissingFileError(error) || error instanceof CorruptSnapshotError) {
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
    sessions: [],
    version: SNAPSHOT_VERSION,
  };
}

function normalizePersistedTerminalSnapshot(input: unknown): PersistedTerminalSnapshot {
  if (!isRecord(input)) {
    return createEmptyPersistedTerminalSnapshot();
  }

  const version = input.version === SNAPSHOT_VERSION ? SNAPSHOT_VERSION : SNAPSHOT_VERSION;
  const sessions = Array.isArray(input.sessions)
    ? input.sessions
        .map((session) => normalizePersistedTerminalSession(session))
        .filter((session): session is PersistedTerminalSession => session !== null)
    : [];

  return {
    sessions,
    version,
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

class CorruptSnapshotError extends Error {
  public constructor(
    public readonly storagePath: string,
    cause: unknown,
  ) {
    super(`Terminal session snapshot is corrupt: ${storagePath}`, { cause });
    this.name = "CorruptSnapshotError";
  }
}
