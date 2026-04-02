import type { WorkItemColumn, WorkItemState } from "./constants";

export interface WorkItemColumnDefinition {
  readonly id: WorkItemColumn;
  readonly label: string;
}

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

export interface WorkItemSelectionState {
  readonly selectedItem: WorkItemBoardCard | null;
  readonly selectedItemId: string | null;
}

export interface WorkItemStoreSummary {
  readonly boardColumns: readonly WorkItemBoardColumn[];
  readonly collapsedColumns: Record<WorkItemColumn, boolean>;
  readonly columnSummaries: readonly WorkItemColumnSummary[];
  readonly latestWorkItemTitle: string | null;
  readonly selectedItem: WorkItemBoardCard | null;
  readonly selectedItemId: string | null;
  readonly storagePath: string | null;
  readonly totalCount: number;
}
