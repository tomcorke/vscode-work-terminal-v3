import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export interface WorkItemBoardCard {
  readonly description: string | null;
  readonly id: string;
  readonly isBlocked: boolean;
  readonly priorityLevel: string;
  readonly sourceKind: string;
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
  readonly columnSummaries: readonly WorkItemColumnSummary[];
  readonly latestWorkItemTitle: string | null;
  readonly storagePath: string | null;
  readonly totalCount: number;
}

export class WorkItemStore {
  public constructor(private readonly workspaceRootPath: string | null) {}

  public getStoragePath(): string | null {
    if (!this.workspaceRootPath) {
      return null;
    }

    return join(this.workspaceRootPath, STORAGE_DIRECTORY_NAME, STORAGE_FILE_NAME);
  }

  public async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem | null> {
    const snapshot = await this.ensureSnapshot();
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return null;
    }

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
  }

  public async getSummary(): Promise<WorkItemStoreSummary> {
    const snapshot = await this.ensureSnapshot();
    const items = Object.values(snapshot.items);
    const latest = [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    return {
      boardColumns: WORK_ITEM_COLUMNS.map((column) => ({
        id: column,
        items: snapshot.itemOrderByColumn[column]
          .map((id) => snapshot.items[id])
          .filter((item): item is WorkItem => Boolean(item))
          .map((item) => ({
            description: item.description,
            id: item.id,
            isBlocked: item.priority.isBlocked,
            priorityLevel: item.priority.level,
            sourceKind: item.source.kind,
            title: item.title,
            updatedAt: item.updatedAt,
          })),
        label: COLUMN_LABELS[column],
      })),
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
    const parsed = JSON.parse(content) as unknown;
    return normalizePersistedWorkItemSnapshot(parsed);
  }

  private async ensureSnapshot(): Promise<PersistedWorkItemSnapshot> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return createEmptyPersistedWorkItemSnapshot();
    }

    try {
      return await this.loadSnapshot();
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      const emptySnapshot = createEmptyPersistedWorkItemSnapshot();
      await this.saveSnapshot(emptySnapshot);
      return emptySnapshot;
    }
  }

  private async saveSnapshot(snapshot: PersistedWorkItemSnapshot): Promise<void> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return;
    }

    await mkdir(dirname(storagePath), { recursive: true });
    await writeFile(storagePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
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
