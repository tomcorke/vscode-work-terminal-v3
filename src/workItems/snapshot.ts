import {
  DEFAULT_WORK_ITEM_COLUMN_ORDER,
  WORK_ITEM_COLUMNS,
  WORK_ITEM_SNAPSHOT_VERSION,
  WORK_ITEM_STATE_TO_COLUMN,
  type WorkItemColumn,
} from "./constants";
import {
  isValidWorkItemId,
  normalizeOptionalString,
  normalizePriorityLevel,
  normalizePriorityScore,
  normalizeSourceKind,
  normalizeTimestamp,
  normalizeWorkItemId,
  normalizeWorkItemState,
} from "./createWorkItem";
import type {
  PersistedWorkItemSnapshot,
  SnapshotValidationIssue,
  WorkItem,
  WorkItemId,
} from "./types";

type UnknownRecord = Record<string, unknown>;

export function createEmptyPersistedWorkItemSnapshot(): PersistedWorkItemSnapshot {
  return {
    version: WORK_ITEM_SNAPSHOT_VERSION,
    items: {},
    columnOrder: [...DEFAULT_WORK_ITEM_COLUMN_ORDER],
    itemOrderByColumn: createEmptyItemOrderByColumn(),
  };
}

export function normalizePersistedWorkItemSnapshot(value: unknown): PersistedWorkItemSnapshot {
  const record = asRecord(value);
  const items = normalizePersistedItems(record.items);
  const columnOrder = normalizeColumnOrder(record.columnOrder);
  const rawItemOrderByColumn = asRecord(record.itemOrderByColumn);
  const itemOrderByColumn = createEmptyItemOrderByColumn();

  for (const column of WORK_ITEM_COLUMNS) {
    const orderedIds = normalizeOrderedIds(rawItemOrderByColumn[column]);

    for (const id of orderedIds) {
      const item = items[id];

      if (item && item.column === column && !itemOrderByColumn[column].includes(id)) {
        itemOrderByColumn[column].push(id);
      }
    }
  }

  for (const item of Object.values(items)) {
    const orderedIds = itemOrderByColumn[item.column];

    if (!orderedIds.includes(item.id)) {
      orderedIds.push(item.id);
    }
  }

  return {
    version: WORK_ITEM_SNAPSHOT_VERSION,
    items,
    columnOrder,
    itemOrderByColumn,
  };
}

export function isPersistedWorkItemSnapshot(value: unknown): value is PersistedWorkItemSnapshot {
  return listPersistedWorkItemSnapshotIssues(value).length === 0;
}

export function listPersistedWorkItemSnapshotIssues(value: unknown): SnapshotValidationIssue[] {
  const issues: SnapshotValidationIssue[] = [];

  if (!isRecord(value)) {
    return [{ path: "", message: "Snapshot must be an object." }];
  }

  if (value.version !== WORK_ITEM_SNAPSHOT_VERSION) {
    issues.push({
      path: "version",
      message: `Snapshot version must be ${WORK_ITEM_SNAPSHOT_VERSION}.`,
    });
  }

  if (!isRecord(value.items)) {
    issues.push({ path: "items", message: "Items must be a record keyed by UUID." });
  } else {
    for (const [id, item] of Object.entries(value.items)) {
      if (!isValidWorkItemId(id)) {
        issues.push({ path: `items.${id}`, message: "Item keys must be UUIDs." });
        continue;
      }

      issues.push(...listPersistedWorkItemIssues(item, `items.${id}`, id));
    }
  }

  if (!Array.isArray(value.columnOrder)) {
    issues.push({ path: "columnOrder", message: "Column order must be an array." });
  } else {
    const seen = new Set<WorkItemColumn>();

    for (const [index, column] of value.columnOrder.entries()) {
      if (!isWorkItemColumn(column)) {
        issues.push({
          path: `columnOrder.${index}`,
          message: "Column order entries must be known columns.",
        });
      } else if (seen.has(column)) {
        issues.push({
          path: `columnOrder.${index}`,
          message: "Column order must not contain duplicates.",
        });
      } else {
        seen.add(column);
      }
    }

    for (const column of WORK_ITEM_COLUMNS) {
      if (!seen.has(column)) {
        issues.push({
          path: "columnOrder",
          message: `Column order is missing "${column}".`,
        });
      }
    }
  }

  if (!isRecord(value.itemOrderByColumn)) {
    issues.push({
      path: "itemOrderByColumn",
      message: "Item order must be a record keyed by column.",
    });
  } else {
    for (const column of WORK_ITEM_COLUMNS) {
      const orderedIds = value.itemOrderByColumn[column];

      if (!Array.isArray(orderedIds)) {
        issues.push({
          path: `itemOrderByColumn.${column}`,
          message: "Column item order must be an array of UUIDs.",
        });
        continue;
      }

      const seenIds = new Set<string>();

      for (const [index, id] of orderedIds.entries()) {
        if (!isValidWorkItemId(id)) {
          issues.push({
            path: `itemOrderByColumn.${column}.${index}`,
            message: "Ordered ids must be UUIDs.",
          });
          continue;
        }

        if (seenIds.has(id)) {
          issues.push({
            path: `itemOrderByColumn.${column}.${index}`,
            message: "Ordered ids must not repeat inside a column.",
          });
          continue;
        }

        seenIds.add(id);

        if (isRecord(value.items)) {
          const item = value.items[id];

          if (!item) {
            issues.push({
              path: `itemOrderByColumn.${column}.${index}`,
              message: "Ordered ids must reference stored items.",
            });
          } else if (isRecord(item)) {
            const itemState = normalizeWorkItemState(item.state);
            const itemColumn = isWorkItemColumn(item.column)
              ? item.column
              : WORK_ITEM_STATE_TO_COLUMN[itemState];

            if (itemColumn !== column) {
              issues.push({
                path: `itemOrderByColumn.${column}.${index}`,
                message: "Ordered ids must live in the column recorded on the item.",
              });
            }
          }
        }
      }
    }
  }

  return issues;
}

function listPersistedWorkItemIssues(
  value: unknown,
  path: string,
  expectedId: WorkItemId,
): SnapshotValidationIssue[] {
  const issues: SnapshotValidationIssue[] = [];

  if (!isRecord(value)) {
    return [{ path, message: "Work item must be an object." }];
  }

  if (value.id !== expectedId) {
    issues.push({ path: `${path}.id`, message: "Item id must match its record key." });
  }

  if (normalizeOptionalString(value.title) === null) {
    issues.push({ path: `${path}.title`, message: "Item title must be a non-empty string." });
  }

  const state = normalizeWorkItemState(value.state);
  const column = isWorkItemColumn(value.column)
    ? value.column
    : WORK_ITEM_STATE_TO_COLUMN[state];

  if (column !== WORK_ITEM_STATE_TO_COLUMN[state]) {
    issues.push({
      path: `${path}.column`,
      message: "Item column must match the column mapped from its state.",
    });
  }

  if (!isRecord(value.source)) {
    issues.push({ path: `${path}.source`, message: "Source metadata must be an object." });
  }

  if (!isRecord(value.priority)) {
    issues.push({ path: `${path}.priority`, message: "Priority metadata must be an object." });
  }

  if (!isKnownWorkItemState(value.state)) {
    issues.push({ path: `${path}.state`, message: "Item state must be a known state." });
  }

  if (!isValidTimestampValue(value.createdAt)) {
    issues.push({ path: `${path}.createdAt`, message: "Created at must be a valid timestamp." });
  }

  if (!isValidTimestampValue(value.updatedAt)) {
    issues.push({ path: `${path}.updatedAt`, message: "Updated at must be a valid timestamp." });
  }

  return issues;
}

function normalizePersistedItems(value: unknown): Record<WorkItemId, WorkItem> {
  const record = asRecord(value);
  const items: Record<WorkItemId, WorkItem> = {};

  for (const [recordId, rawItem] of Object.entries(record)) {
    const item = normalizePersistedWorkItem(rawItem, recordId);

    if (item) {
      items[item.id] = item;
    }
  }

  return items;
}

function normalizePersistedWorkItem(value: unknown, recordId: string): WorkItem | null {
  const item = asRecord(value);
  const id = normalizeWorkItemId(item.id) ?? normalizeWorkItemId(recordId);

  if (!id) {
    return null;
  }

  const state = normalizeWorkItemState(item.state);
  const column = WORK_ITEM_STATE_TO_COLUMN[state];
  const createdAt = normalizeTimestamp(asTimestampInput(item.createdAt));
  const updatedAt = normalizeTimestamp(asTimestampInput(item.updatedAt), createdAt);
  const completedAt = isTerminalColumn(column)
    ? normalizeNullableTimestamp(item.completedAt, null)
    : null;
  const source = asRecord(item.source);
  const priority = asRecord(item.priority);

  return {
    id,
    title: normalizeOptionalString(item.title) ?? "Untitled work item",
    description: normalizeOptionalString(item.description),
    state,
    column,
    source: {
      kind: normalizeSourceKind(source.kind),
      externalId: normalizeOptionalString(source.externalId),
      url: normalizeOptionalString(source.url),
      path: normalizeOptionalString(source.path),
      fingerprint: normalizeOptionalString(source.fingerprint),
      capturedAt: normalizeNullableTimestamp(source.capturedAt, null),
    },
    priority: {
      level: normalizePriorityLevel(priority.level),
      score: normalizePriorityScore(priority.score),
      deadline: normalizeOptionalString(priority.deadline),
      isBlocked: Boolean(priority.isBlocked),
      blockerReason: normalizeOptionalString(priority.blockerReason),
    },
    createdAt,
    updatedAt,
    completedAt,
  };
}

function createEmptyItemOrderByColumn(): Record<WorkItemColumn, WorkItemId[]> {
  return {
    priority: [],
    todo: [],
    active: [],
    done: [],
  };
}

function normalizeColumnOrder(value: unknown): WorkItemColumn[] {
  const orderedColumns = Array.isArray(value) ? value : [];
  const deduped: WorkItemColumn[] = [];

  for (const column of orderedColumns) {
    if (isWorkItemColumn(column) && !deduped.includes(column)) {
      deduped.push(column);
    }
  }

  for (const column of DEFAULT_WORK_ITEM_COLUMN_ORDER) {
    if (!deduped.includes(column)) {
      deduped.push(column);
    }
  }

  return deduped;
}

function normalizeOrderedIds(value: unknown): WorkItemId[] {
  const ids = Array.isArray(value) ? value : [];
  const deduped: WorkItemId[] = [];

  for (const id of ids) {
    const normalizedId = normalizeWorkItemId(id);

    if (normalizedId && !deduped.includes(normalizedId)) {
      deduped.push(normalizedId);
    }
  }

  return deduped;
}

function normalizeNullableTimestamp(value: unknown, fallback: string | null): string | null {
  if (value == null) {
    return fallback;
  }

  return normalizeTimestamp(asTimestampInput(value), fallback ?? undefined);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asTimestampInput(value: unknown): string | Date | undefined {
  return typeof value === "string" || value instanceof Date ? value : undefined;
}

function isWorkItemColumn(value: unknown): value is WorkItemColumn {
  return value === "priority" || value === "todo" || value === "active" || value === "done";
}

function isKnownWorkItemState(value: unknown): boolean {
  return (
    value === "priority" ||
    value === "todo" ||
    value === "active" ||
    value === "done" ||
    value === "abandoned"
  );
}

function isValidTimestampValue(value: unknown): boolean {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.valueOf());
}

function isTerminalColumn(column: WorkItemColumn): boolean {
  return column === "done";
}
