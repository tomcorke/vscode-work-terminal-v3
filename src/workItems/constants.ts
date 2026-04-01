export const WORK_ITEM_STATES = ["priority", "todo", "active", "done", "abandoned"] as const;

export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

export const WORK_ITEM_COLUMNS = ["priority", "todo", "active", "done"] as const;

export type WorkItemColumn = (typeof WORK_ITEM_COLUMNS)[number];

export const WORK_ITEM_SOURCE_KINDS = [
  "manual",
  "prompt",
  "jira",
  "slack",
  "confluence",
  "markdown",
  "other",
] as const;

export type WorkItemSourceKind = (typeof WORK_ITEM_SOURCE_KINDS)[number];

export const WORK_ITEM_PRIORITY_LEVELS = ["none", "low", "medium", "high", "critical"] as const;

export type WorkItemPriorityLevel = (typeof WORK_ITEM_PRIORITY_LEVELS)[number];

export const DEFAULT_WORK_ITEM_STATE: WorkItemState = "todo";

export const DEFAULT_WORK_ITEM_PRIORITY_LEVEL: WorkItemPriorityLevel = "medium";

export const DEFAULT_WORK_ITEM_COLUMN_ORDER = [...WORK_ITEM_COLUMNS];

// State and column are intentionally separate so terminal states can share a board column.
export const WORK_ITEM_STATE_TO_COLUMN: Record<WorkItemState, WorkItemColumn> = {
  priority: "priority",
  todo: "todo",
  active: "active",
  done: "done",
  abandoned: "done",
};

export const WORK_ITEM_SNAPSHOT_VERSION = 1 as const;
