import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { WorkItemColumn } from "./constants";
import type { WorkItemSourceAdapter } from "./adapter";
import type { WorkItemColumnDefinition, WorkItemStoreSummary } from "./board";
import { createBuiltInJsonWorkItemSourceAdapter } from "./builtInJsonAdapter";
import type {
  CreateWorkItemInput,
  PersistedWorkItemSnapshot,
  SplitWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
} from "./types";

export class WorkItemStore {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly workspaceRootPath: string | null,
    private readonly adapter: WorkItemSourceAdapter = createBuiltInJsonWorkItemSourceAdapter(),
  ) {}

  public getStoragePath(): string | null {
    if (!this.workspaceRootPath) {
      return null;
    }

    return this.adapter.config.getStoragePath(this.workspaceRootPath);
  }

  public getColumnDefinitions(): readonly WorkItemColumnDefinition[] {
    return this.adapter.config.getColumnDefinitions();
  }

  public getColumnLabel(column: WorkItemColumn): string {
    return this.getColumnDefinitions().find((definition) => definition.id === column)?.label ?? column;
  }

  public async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem | null> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return null;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const result = this.adapter.mover.createItem(snapshot, input);
      await this.saveSnapshot(result.snapshot);
      return result.item;
    });
  }

  public async getWorkItem(itemId: string): Promise<WorkItem | null> {
    const snapshot = await this.loadSnapshotForRead();
    return snapshot.items[itemId] ?? null;
  }

  public async getSummary(requestedSelectedItemId: string | null = null): Promise<WorkItemStoreSummary> {
    const snapshot = await this.loadSnapshotForRead();
    const items = Object.values(snapshot.items);
    const latest = [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const selectionState = this.adapter.renderer.resolveSelectionState(snapshot, requestedSelectedItemId);

    return {
      boardColumns: this.adapter.renderer.renderBoardColumns(snapshot),
      collapsedColumns: { ...snapshot.collapsedColumns },
      columnSummaries: this.adapter.renderer.renderColumnSummaries(snapshot),
      latestWorkItemTitle: latest?.title ?? null,
      selectedItem: selectionState.selectedItem,
      selectedItemId: selectionState.selectedItemId,
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
      const result = this.adapter.mover.updateItem(snapshot, itemId, updates);
      if (!result.item) {
        return null;
      }

      await this.saveSnapshot(result.snapshot);
      return result.item;
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
      const result = this.adapter.mover.reorderItems(snapshot, itemId, fromColumn, toColumn, targetIndex);
      if (!result.reordered) {
        return false;
      }

      await this.saveSnapshot(result.snapshot);
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
      const result = this.adapter.mover.moveItemToColumn(snapshot, itemId, toColumn, targetIndex);
      if (!result.item) {
        return null;
      }

      await this.saveSnapshot(result.snapshot);
      return result.item;
    });
  }

  public async deleteWorkItem(itemId: string): Promise<boolean> {
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      return false;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      const result = this.adapter.mover.deleteItem(snapshot, itemId);
      if (!result.deleted) {
        return false;
      }

      await this.saveSnapshot(result.snapshot);
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
      const result = this.adapter.mover.splitItem(snapshot, itemId, input);
      if (!result.item) {
        return null;
      }

      await this.saveSnapshot(result.snapshot);
      return result.item;
    });
  }

  public async toggleColumnCollapsed(column: WorkItemColumn): Promise<boolean> {
    const storagePath = this.getStoragePath();
    if (!storagePath) {
      return false;
    }

    return this.withWriteLock(async () => {
      const snapshot = await this.loadSnapshotForWrite();
      await this.saveSnapshot(this.adapter.mover.toggleColumnCollapsed(snapshot, column));
      return true;
    });
  }

  public async loadSnapshot(): Promise<PersistedWorkItemSnapshot> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return this.adapter.parser.createEmptySnapshot();
    }

    const content = await readFile(storagePath, "utf8");

    try {
      const parsed = JSON.parse(content) as unknown;
      return this.adapter.parser.parseSnapshot(parsed);
    } catch (error) {
      throw new CorruptSnapshotError(storagePath, error);
    }
  }

  private async loadSnapshotForRead(): Promise<PersistedWorkItemSnapshot> {
    try {
      return await this.loadSnapshot();
    } catch (error) {
      if (isMissingFileError(error) || error instanceof CorruptSnapshotError) {
        return this.adapter.parser.createEmptySnapshot();
      }

      throw error;
    }
  }

  private async loadSnapshotForWrite(): Promise<PersistedWorkItemSnapshot> {
    const storagePath = this.getStoragePath();

    if (!storagePath) {
      return this.adapter.parser.createEmptySnapshot();
    }

    try {
      return await this.loadSnapshot();
    } catch (error) {
      if (error instanceof CorruptSnapshotError) {
        console.warn(
          `[work-terminal] Snapshot at ${error.storagePath} was corrupt. Backing it up and resetting the store.`,
        );
        await this.backupCorruptSnapshot(error.storagePath);
        return this.adapter.parser.createEmptySnapshot();
      }

      if (!isMissingFileError(error)) {
        throw error;
      }

      return this.adapter.parser.createEmptySnapshot();
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

export interface WorkItemWorkflowStore {
  createWorkItem(input: CreateWorkItemInput): Promise<WorkItem | null>;
  deleteWorkItem(itemId: string): Promise<boolean>;
  getColumnDefinitions(): readonly WorkItemColumnDefinition[];
  getColumnLabel(column: WorkItemColumn): string;
  getSummary(requestedSelectedItemId?: string | null): Promise<WorkItemStoreSummary>;
  getWorkItem(itemId: string): Promise<WorkItem | null>;
  moveItemToColumn(itemId: string, toColumn: WorkItemColumn, targetIndex?: number): Promise<WorkItem | null>;
  reorderItems(
    itemId: string,
    fromColumn: WorkItemColumn,
    toColumn: WorkItemColumn,
    targetIndex: number,
  ): Promise<boolean>;
  splitWorkItem(itemId: string, input: SplitWorkItemInput): Promise<WorkItem | null>;
  toggleColumnCollapsed(column: WorkItemColumn): Promise<boolean>;
  updateWorkItem(itemId: string, updates: UpdateWorkItemInput): Promise<WorkItem | null>;
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
