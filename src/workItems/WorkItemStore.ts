import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createEmptyPersistedWorkItemSnapshot,
  createWorkItem,
  normalizePersistedWorkItemSnapshot,
  WORK_ITEM_COLUMNS,
  type CreateWorkItemInput,
  type PersistedWorkItemSnapshot,
  type WorkItem,
  type WorkItemColumn,
} from "./index";

const STORAGE_DIRECTORY_NAME = ".work-terminal";
const STORAGE_FILE_NAME = "work-items.v1.json";

const COLUMN_LABELS: Record<WorkItemColumn, string> = {
  priority: "Priority",
  todo: "To Do",
  active: "Active",
  done: "Done",
};

export interface WorkItemColumnSummary {
  readonly id: WorkItemColumn;
  readonly label: string;
  readonly count: number;
}

export interface WorkItemStoreSummary {
  readonly columnSummaries: readonly WorkItemColumnSummary[];
  readonly latestWorkItemTitle: string | null;
  readonly storagePath: string | null;
  readonly totalCount: number;
}

export class WorkItemStore {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly workspaceRootPath: string | null) {}

  public getStoragePath(): string | null {
    if (!this.workspaceRootPath) {
      return null;
    }

    return join(this.workspaceRootPath, STORAGE_DIRECTORY_NAME, STORAGE_FILE_NAME);
  }

  public async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem | null> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return null;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const item = createWorkItem(input);
      const nextSnapshot: PersistedWorkItemSnapshot = {
        ...snapshot,
        items: {
          ...snapshot.items,
          [item.id]: item,
        },
        itemOrderByColumn: {
          ...snapshot.itemOrderByColumn,
          [item.column]: [item.id, ...snapshot.itemOrderByColumn[item.column].filter((id) => id !== item.id)],
        },
      };

      await this.saveSnapshot(nextSnapshot);

      return item;
    });
  }

  public async getSummary(): Promise<WorkItemStoreSummary> {
    const snapshot = await this.loadSnapshotForRead();
    const items = Object.values(snapshot.items);
    const latest = [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    return {
      columnSummaries: WORK_ITEM_COLUMNS.map((column) => ({
        id: column,
        label: COLUMN_LABELS[column],
        count: snapshot.itemOrderByColumn[column].length,
      })),
      latestWorkItemTitle: latest?.title ?? null,
      storagePath: this.getStoragePath(),
      totalCount: items.length,
    };
  }

  public async loadSnapshot(): Promise<PersistedWorkItemSnapshot> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return createEmptyPersistedWorkItemSnapshot();
    }

    const content = await readFile(storagePath, "utf8");

    try {
      const parsed = JSON.parse(content) as unknown;
      return normalizePersistedWorkItemSnapshot(parsed);
    } catch (error) {
      throw new CorruptSnapshotError(storagePath, error);
    }
  }

  private async loadSnapshotForRead(): Promise<PersistedWorkItemSnapshot> {
    try {
      return await this.loadSnapshot();
    } catch (error) {
      if (isMissingFileError(error) || error instanceof CorruptSnapshotError) {
        return createEmptyPersistedWorkItemSnapshot();
      }

      throw error;
    }
  }

  private async loadSnapshotForWrite(): Promise<PersistedWorkItemSnapshot> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return createEmptyPersistedWorkItemSnapshot();
    }

    try {
      return await this.loadSnapshot();
    } catch (error) {
      if (error instanceof CorruptSnapshotError) {
        console.warn(
          `[work-terminal] Snapshot at ${error.storagePath} was corrupt. Backing it up and resetting the store.`,
        );
        await this.backupCorruptSnapshot(error.storagePath);
        return createEmptyPersistedWorkItemSnapshot();
      }

      if (!isMissingFileError(error)) {
        throw error;
      }

      return createEmptyPersistedWorkItemSnapshot();
    }
  }

  private async saveSnapshot(snapshot: PersistedWorkItemSnapshot): Promise<void> {
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

class CorruptSnapshotError extends Error {
  public constructor(
    public readonly storagePath: string,
    cause: unknown,
  ) {
    super(`Work item snapshot is corrupt: ${storagePath}`, { cause });
    this.name = "CorruptSnapshotError";
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
