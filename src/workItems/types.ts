import type {
  WORK_ITEM_SNAPSHOT_VERSION,
  WorkItemColumn,
  WorkItemPriorityLevel,
  WorkItemSourceKind,
  WorkItemState,
} from "./constants";

export type WorkItemId = string;

export interface WorkItemSourceMetadata {
  readonly kind: WorkItemSourceKind;
  readonly externalId: string | null;
  readonly url: string | null;
  readonly path: string | null;
  readonly fingerprint: string | null;
  readonly capturedAt: string | null;
}

export interface WorkItemPriorityMetadata {
  readonly level: WorkItemPriorityLevel;
  readonly score: number;
  readonly deadline: string | null;
  readonly isBlocked: boolean;
  readonly blockerReason: string | null;
}

export interface WorkItem {
  readonly id: WorkItemId;
  readonly title: string;
  readonly description: string | null;
  readonly state: WorkItemState;
  readonly column: WorkItemColumn;
  readonly source: WorkItemSourceMetadata;
  readonly priority: WorkItemPriorityMetadata;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface CreateWorkItemInput {
  readonly title: string;
  readonly description?: string | null;
  readonly id?: WorkItemId;
  readonly state?: WorkItemState;
  readonly source?: Partial<WorkItemSourceMetadata>;
  readonly priority?: Partial<WorkItemPriorityMetadata>;
  readonly now?: string | Date;
}

export interface PersistedWorkItemSnapshot {
  readonly version: typeof WORK_ITEM_SNAPSHOT_VERSION;
  readonly collapsedColumns: Record<WorkItemColumn, boolean>;
  readonly items: Record<WorkItemId, WorkItem>;
  readonly columnOrder: WorkItemColumn[];
  // These arrays are the canonical ordering source for the board.
  readonly itemOrderByColumn: Record<WorkItemColumn, WorkItemId[]>;
}

export interface SnapshotValidationIssue {
  readonly path: string;
  readonly message: string;
}
