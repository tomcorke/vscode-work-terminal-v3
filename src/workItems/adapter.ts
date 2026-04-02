import type {
  CreateWorkItemInput,
  PersistedWorkItemSnapshot,
  SnapshotValidationIssue,
  SplitWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
} from "./types";
import type { WorkItemColumn } from "./constants";
import type {
  WorkItemBoardColumn,
  WorkItemColumnDefinition,
  WorkItemColumnSummary,
  WorkItemSelectionState,
} from "./board";

export interface WorkItemPromptContext {
  readonly description: string | null;
  readonly title: string;
}

export interface WorkItemSourceParser {
  createEmptySnapshot(): PersistedWorkItemSnapshot;
  listSnapshotIssues(value: unknown): SnapshotValidationIssue[];
  parseSnapshot(value: unknown): PersistedWorkItemSnapshot;
}

export interface WorkItemSourceMover {
  createItem(snapshot: PersistedWorkItemSnapshot, input: CreateWorkItemInput): {
    readonly item: WorkItem;
    readonly snapshot: PersistedWorkItemSnapshot;
  };
  deleteItem(snapshot: PersistedWorkItemSnapshot, itemId: string): {
    readonly deleted: boolean;
    readonly snapshot: PersistedWorkItemSnapshot;
  };
  moveItemToColumn(
    snapshot: PersistedWorkItemSnapshot,
    itemId: string,
    toColumn: WorkItemColumn,
    targetIndex: number,
  ): {
    readonly item: WorkItem | null;
    readonly snapshot: PersistedWorkItemSnapshot;
  };
  reorderItems(
    snapshot: PersistedWorkItemSnapshot,
    itemId: string,
    fromColumn: WorkItemColumn,
    toColumn: WorkItemColumn,
    targetIndex: number,
  ): {
    readonly reordered: boolean;
    readonly snapshot: PersistedWorkItemSnapshot;
  };
  splitItem(snapshot: PersistedWorkItemSnapshot, itemId: string, input: SplitWorkItemInput): {
    readonly item: WorkItem | null;
    readonly snapshot: PersistedWorkItemSnapshot;
  };
  toggleColumnCollapsed(snapshot: PersistedWorkItemSnapshot, column: WorkItemColumn): PersistedWorkItemSnapshot;
  updateItem(snapshot: PersistedWorkItemSnapshot, itemId: string, updates: UpdateWorkItemInput): {
    readonly item: WorkItem | null;
    readonly snapshot: PersistedWorkItemSnapshot;
  };
}

export interface WorkItemSourceRenderer {
  renderBoardColumns(snapshot: PersistedWorkItemSnapshot): readonly WorkItemBoardColumn[];
  renderColumnSummaries(snapshot: PersistedWorkItemSnapshot): readonly WorkItemColumnSummary[];
  resolveSelectionState(snapshot: PersistedWorkItemSnapshot, selectedItemId: string | null): WorkItemSelectionState;
}

export interface WorkItemSourcePromptBuilder {
  buildContextPrompt(context: WorkItemPromptContext): string;
}

export interface WorkItemSourceConfig {
  getColumnDefinitions(): readonly WorkItemColumnDefinition[];
  getStoragePath(workspaceRootPath: string): string;
}

export interface WorkItemSourceAdapter {
  readonly config: WorkItemSourceConfig;
  readonly mover: WorkItemSourceMover;
  readonly parser: WorkItemSourceParser;
  readonly promptBuilder: WorkItemSourcePromptBuilder;
  readonly renderer: WorkItemSourceRenderer;
}
