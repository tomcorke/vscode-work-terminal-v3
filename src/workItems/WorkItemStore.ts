import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createEmptyPersistedWorkItemSnapshot,
  createWorkItem,
  normalizeOptionalString,
  normalizePriorityLevel,
  normalizePriorityScore,
  normalizeSourceKind,
  normalizeTimestamp,
  normalizePersistedWorkItemSnapshot,
  WORK_ITEM_COLUMNS,
  WORK_ITEM_STATE_TO_COLUMN,
  type WorkItem,
  type CreateWorkItemInput,
  type PersistedWorkItemSnapshot,
  type SplitWorkItemInput,
  type WorkItemColumn,
  type WorkItemState,
  type UpdateWorkItemInput,
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

export interface WorkItemBoardCard {
  readonly blockerReason: string | null;
  readonly column: WorkItemColumn;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly description: string | null;
  readonly id: string;
  readonly isBlocked: boolean;
  readonly priorityDeadline: string | null;
  readonly priorityLevel: string;
  readonly priorityScore: number;
  readonly sourceCapturedAt: string | null;
  readonly sourceExternalId: string | null;
  readonly sourceKind: string;
  readonly sourcePath: string | null;
  readonly sourceUrl: string | null;
  readonly state: WorkItemState;
  readonly title: string;
  readonly updatedAt: string;
}

export interface WorkItemBoardColumn {
  readonly id: WorkItemColumn;
  readonly items: readonly WorkItemBoardCard[];
  readonly label: string;
}

export interface WorkItemStoreSummary {
  readonly boardColumns: readonly WorkItemBoardColumn[];
  readonly collapsedColumns: Record<WorkItemColumn, boolean>;
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

  public async getWorkItem(itemId: string): Promise<WorkItem | null> {
    const snapshot = await this.loadSnapshotForRead();
    return snapshot.items[itemId] ?? null;
  }

  public async getSummary(): Promise<WorkItemStoreSummary> {
    const snapshot = await this.loadSnapshotForRead();
    const items = Object.values(snapshot.items);
    const latest = [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    return {
      boardColumns: WORK_ITEM_COLUMNS.map((column) => ({
        id: column,
        items: snapshot.itemOrderByColumn[column]
          .map((id) => snapshot.items[id])
          .filter((item): item is WorkItem => Boolean(item))
          .map((item) => ({
            blockerReason: item.priority.blockerReason,
            column: item.column,
            completedAt: item.completedAt,
            createdAt: item.createdAt,
            description: item.description,
            id: item.id,
            isBlocked: item.priority.isBlocked,
            priorityDeadline: item.priority.deadline,
            priorityLevel: item.priority.level,
            priorityScore: item.priority.score,
            sourceCapturedAt: item.source.capturedAt,
            sourceExternalId: item.source.externalId,
            sourceKind: item.source.kind,
            sourcePath: item.source.path,
            sourceUrl: item.source.url,
            state: item.state,
            title: item.title,
            updatedAt: item.updatedAt,
          })),
        label: COLUMN_LABELS[column],
      })),
      collapsedColumns: { ...snapshot.collapsedColumns },
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

  public async updateWorkItem(itemId: string, updates: UpdateWorkItemInput): Promise<WorkItem | null> {
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      return null;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const item = snapshot.items[itemId];
      if (!item) {
        return null;
      }

      const timestamp = normalizeTimestamp(updates.now, new Date().toISOString());
      const nextState = updates.state ? normalizeState(updates.state) : item.state;
      const nextColumn = WORK_ITEM_STATE_TO_COLUMN[nextState];
      const requestedBlocked = updates.priority?.isBlocked;
      const nextBlocked = requestedBlocked == null ? item.priority.isBlocked : Boolean(requestedBlocked);
      const nextItem: WorkItem = {
        ...item,
        title: updates.title == null ? item.title : normalizeOptionalString(updates.title) ?? item.title,
        description: updates.description === undefined ? item.description : normalizeOptionalString(updates.description),
        state: nextState,
        column: nextColumn,
        source: {
          kind: updates.source?.kind == null ? item.source.kind : normalizeSourceKind(updates.source.kind),
          externalId: updates.source?.externalId === undefined
            ? item.source.externalId
            : normalizeOptionalString(updates.source.externalId),
          url: updates.source?.url === undefined
            ? item.source.url
            : normalizeOptionalString(updates.source.url),
          path: updates.source?.path === undefined
            ? item.source.path
            : normalizeOptionalString(updates.source.path),
          fingerprint: updates.source?.fingerprint === undefined
            ? item.source.fingerprint
            : normalizeOptionalString(updates.source.fingerprint),
          capturedAt: updates.source?.capturedAt === undefined
            ? item.source.capturedAt
            : normalizeOptionalString(updates.source.capturedAt),
        },
        priority: {
          level: updates.priority?.level == null ? item.priority.level : normalizePriorityLevel(updates.priority.level),
          score: updates.priority?.score == null ? item.priority.score : normalizePriorityScore(updates.priority.score),
          deadline: updates.priority?.deadline === undefined
            ? item.priority.deadline
            : normalizeOptionalString(updates.priority.deadline),
          isBlocked: nextBlocked,
          blockerReason: nextBlocked
            ? updates.priority?.blockerReason === undefined
              ? item.priority.blockerReason
              : normalizeOptionalString(updates.priority.blockerReason)
            : null,
        },
        updatedAt: timestamp,
        completedAt: nextColumn === "done"
          ? item.completedAt ?? timestamp
          : null,
      };

      const nextSnapshot = moveItemWithinSnapshot(snapshot, nextItem, timestamp);
      await this.saveSnapshot(nextSnapshot);
      return nextItem;
    });
  }

  public async reorderItems(
    itemId: string,
    fromColumn: WorkItemColumn,
    toColumn: WorkItemColumn,
    targetIndex: number,
  ): Promise<boolean> {
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      return false;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const item = snapshot.items[itemId];
      if (!item || item.column !== fromColumn) {
        return false;
      }

      const nextState = fromColumn === toColumn ? item.state : getStateForColumn(toColumn);
      const normalizedIndex = Math.max(0, Math.min(targetIndex, snapshot.itemOrderByColumn[toColumn].length));
      const nextItemOrderByColumn = Object.fromEntries(
        WORK_ITEM_COLUMNS.map((column) => [column, snapshot.itemOrderByColumn[column].filter((id) => id !== itemId)]),
      ) as Record<WorkItemColumn, string[]>;

      nextItemOrderByColumn[toColumn].splice(normalizedIndex, 0, itemId);

      const timestamp = new Date().toISOString();
      const nextItem: WorkItem = {
        ...item,
        column: toColumn,
        state: nextState,
        updatedAt: timestamp,
        completedAt: toColumn === "done" ? item.completedAt ?? timestamp : null,
      };

      await this.saveSnapshot({
        ...snapshot,
        items: {
          ...snapshot.items,
          [itemId]: nextItem,
        },
        itemOrderByColumn: nextItemOrderByColumn,
      });

      return true;
    });
  }

  public async moveItemToColumn(
    itemId: string,
    toColumn: WorkItemColumn,
    targetIndex = 0,
  ): Promise<WorkItem | null> {
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      return null;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const item = snapshot.items[itemId];
      if (!item) {
        return null;
      }

      const normalizedIndex = Math.max(0, Math.min(targetIndex, snapshot.itemOrderByColumn[toColumn].length));
      const timestamp = new Date().toISOString();
      const nextState = item.column === toColumn ? item.state : getStateForColumn(toColumn);
      const nextItem: WorkItem = {
        ...item,
        column: toColumn,
        state: nextState,
        updatedAt: timestamp,
        completedAt: toColumn === "done"
          ? item.completedAt ?? timestamp
          : null,
      };
      const nextSnapshot = moveItemWithinSnapshot(snapshot, nextItem, timestamp, normalizedIndex);
      await this.saveSnapshot(nextSnapshot);
      return nextItem;
    });
  }

  public async deleteWorkItem(itemId: string): Promise<boolean> {
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      return false;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      if (!snapshot.items[itemId]) {
        return false;
      }

      const nextItems = { ...snapshot.items };
      delete nextItems[itemId];

      const nextSnapshot: PersistedWorkItemSnapshot = {
        ...snapshot,
        items: nextItems,
        itemOrderByColumn: Object.fromEntries(
          WORK_ITEM_COLUMNS.map((column) => [column, snapshot.itemOrderByColumn[column].filter((id) => id !== itemId)]),
        ) as Record<WorkItemColumn, string[]>,
      };

      await this.saveSnapshot(nextSnapshot);
      return true;
    });
  }

  public async splitWorkItem(itemId: string, input: SplitWorkItemInput): Promise<WorkItem | null> {
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      return null;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const item = snapshot.items[itemId];
      if (!item) {
        return null;
      }

      const fallbackState = item.column === "done" ? "todo" : item.state;
      const nextDescription = normalizeOptionalString(input.description) ?? buildSplitDescription(item);
      const nextItem = createWorkItem({
        title: input.title,
        description: nextDescription,
        state: input.state ?? fallbackState,
        source: { ...item.source },
        priority: { ...item.priority },
        now: input.now,
      });
      const nextColumn = nextItem.column;
      const existingOrder = snapshot.itemOrderByColumn[nextColumn].filter((id) => id !== nextItem.id);
      const parentIndex = nextColumn === item.column ? existingOrder.indexOf(item.id) : -1;
      const insertionIndex = parentIndex >= 0 ? parentIndex + 1 : 0;
      const nextOrder = [...existingOrder];
      nextOrder.splice(insertionIndex, 0, nextItem.id);

      const nextSnapshot: PersistedWorkItemSnapshot = {
        ...snapshot,
        items: {
          ...snapshot.items,
          [nextItem.id]: nextItem,
        },
        itemOrderByColumn: {
          ...snapshot.itemOrderByColumn,
          [nextColumn]: nextOrder,
        },
      };

      await this.saveSnapshot(nextSnapshot);
      return nextItem;
    });
  }

  public async toggleColumnCollapsed(column: WorkItemColumn): Promise<boolean> {
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      return false;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      await this.saveSnapshot({
        ...snapshot,
        collapsedColumns: {
          ...snapshot.collapsedColumns,
          [column]: !snapshot.collapsedColumns[column],
        },
      });
      return true;
    });
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

function getStateForColumn(column: WorkItemColumn): WorkItem["state"] {
  switch (column) {
    case "priority":
      return "priority";
    case "todo":
      return "todo";
    case "active":
      return "active";
    case "done":
      return "done";
  }
}

function normalizeState(state: WorkItemState): WorkItemState {
  return state === "priority" ||
    state === "todo" ||
    state === "active" ||
    state === "done" ||
    state === "abandoned"
    ? state
    : "todo";
}

function moveItemWithinSnapshot(
  snapshot: PersistedWorkItemSnapshot,
  nextItem: WorkItem,
  timestamp: string,
  targetIndex?: number,
): PersistedWorkItemSnapshot {
  const previousIndex = snapshot.itemOrderByColumn[nextItem.column].indexOf(nextItem.id);
  const nextItemOrderByColumn = Object.fromEntries(
    WORK_ITEM_COLUMNS.map((column) => [column, snapshot.itemOrderByColumn[column].filter((id) => id !== nextItem.id)]),
  ) as Record<WorkItemColumn, string[]>;
  const nextColumnItems = nextItemOrderByColumn[nextItem.column];
  const normalizedIndex = targetIndex == null
    ? previousIndex >= 0 ? Math.min(previousIndex, nextColumnItems.length) : nextColumnItems.length
    : Math.max(0, Math.min(targetIndex, nextColumnItems.length));
  nextColumnItems.splice(normalizedIndex, 0, nextItem.id);

  return {
    ...snapshot,
    items: {
      ...snapshot.items,
      [nextItem.id]: {
        ...nextItem,
        updatedAt: timestamp,
      },
    },
    itemOrderByColumn: nextItemOrderByColumn,
  };
}

function buildSplitDescription(item: WorkItem): string {
  const prefix = `Split from "${item.title}".`;
  return item.description ? `${prefix}\n\n${item.description}` : prefix;
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
