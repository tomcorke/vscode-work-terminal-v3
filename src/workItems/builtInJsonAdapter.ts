import { join } from "node:path";

import {
  WORK_ITEM_COLUMNS,
  type WorkItemColumn,
  type WorkItemState,
} from "./constants";
import {
  createEmptyPersistedWorkItemSnapshot,
  listPersistedWorkItemSnapshotIssues,
  normalizePersistedWorkItemSnapshot,
} from "./snapshot";
import {
  createWorkItem,
  normalizeOptionalString,
  normalizePriorityLevel,
  normalizePriorityScore,
  normalizeSourceKind,
  normalizeTimestamp,
} from "./createWorkItem";
import type {
  CreateWorkItemInput,
  PersistedWorkItemSnapshot,
  SplitWorkItemInput,
  UpdateWorkItemInput,
  WorkItem,
} from "./types";
import type { WorkItemSourceAdapter } from "./adapter";
import type {
  WorkItemBoardCard,
  WorkItemBoardColumn,
  WorkItemColumnDefinition,
  WorkItemColumnSummary,
  WorkItemSelectionState,
} from "./board";

const STORAGE_DIRECTORY_NAME = ".work-terminal";
const STORAGE_FILE_NAME = "work-items.v1.json";

const COLUMN_DEFINITIONS: readonly WorkItemColumnDefinition[] = [
  { id: "priority", label: "Priority" },
  { id: "todo", label: "To Do" },
  { id: "active", label: "Active" },
  { id: "done", label: "Done" },
] as const;

export function createBuiltInJsonWorkItemSourceAdapter(): WorkItemSourceAdapter {
  return {
    config: {
      getColumnDefinitions(): readonly WorkItemColumnDefinition[] {
        return COLUMN_DEFINITIONS;
      },
      getStoragePath(workspaceRootPath: string): string {
        return join(workspaceRootPath, STORAGE_DIRECTORY_NAME, STORAGE_FILE_NAME);
      },
    },
    parser: {
      createEmptySnapshot(): PersistedWorkItemSnapshot {
        return createEmptyPersistedWorkItemSnapshot();
      },
      listSnapshotIssues(value: unknown) {
        return listPersistedWorkItemSnapshotIssues(value);
      },
      parseSnapshot(value: unknown): PersistedWorkItemSnapshot {
        return normalizePersistedWorkItemSnapshot(value);
      },
    },
    mover: {
      createItem(snapshot: PersistedWorkItemSnapshot, input: CreateWorkItemInput) {
        const item = createWorkItem(input);
        return {
          item,
          snapshot: {
            ...snapshot,
            items: {
              ...snapshot.items,
              [item.id]: item,
            },
            itemOrderByColumn: {
              ...snapshot.itemOrderByColumn,
              [item.column]: [item.id, ...snapshot.itemOrderByColumn[item.column].filter((id) => id !== item.id)],
            },
          },
        };
      },
      deleteItem(snapshot: PersistedWorkItemSnapshot, itemId: string) {
        if (!snapshot.items[itemId]) {
          return {
            deleted: false,
            snapshot,
          };
        }

        const nextItems = { ...snapshot.items };
        delete nextItems[itemId];

        return {
          deleted: true,
          snapshot: {
            ...snapshot,
            items: nextItems,
            itemOrderByColumn: Object.fromEntries(
              WORK_ITEM_COLUMNS.map((column) => [column, snapshot.itemOrderByColumn[column].filter((id) => id !== itemId)]),
            ) as Record<WorkItemColumn, string[]>,
          },
        };
      },
      moveItemToColumn(snapshot: PersistedWorkItemSnapshot, itemId: string, toColumn: WorkItemColumn, targetIndex: number) {
        const item = snapshot.items[itemId];
        if (!item) {
          return {
            item: null,
            snapshot,
          };
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

        return {
          item: nextItem,
          snapshot: moveItemWithinSnapshot(snapshot, nextItem, timestamp, normalizedIndex),
        };
      },
      reorderItems(
        snapshot: PersistedWorkItemSnapshot,
        itemId: string,
        fromColumn: WorkItemColumn,
        toColumn: WorkItemColumn,
        targetIndex: number,
      ) {
        const item = snapshot.items[itemId];
        if (!item || item.column !== fromColumn) {
          return {
            reordered: false,
            snapshot,
          };
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

        return {
          reordered: true,
          snapshot: {
            ...snapshot,
            items: {
              ...snapshot.items,
              [itemId]: nextItem,
            },
            itemOrderByColumn: nextItemOrderByColumn,
          },
        };
      },
      splitItem(snapshot: PersistedWorkItemSnapshot, itemId: string, input: SplitWorkItemInput) {
        const item = snapshot.items[itemId];
        if (!item) {
          return {
            item: null,
            snapshot,
          };
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

        return {
          item: nextItem,
          snapshot: {
            ...snapshot,
            items: {
              ...snapshot.items,
              [nextItem.id]: nextItem,
            },
            itemOrderByColumn: {
              ...snapshot.itemOrderByColumn,
              [nextColumn]: nextOrder,
            },
          },
        };
      },
      toggleColumnCollapsed(snapshot: PersistedWorkItemSnapshot, column: WorkItemColumn) {
        return {
          ...snapshot,
          collapsedColumns: {
            ...snapshot.collapsedColumns,
            [column]: !snapshot.collapsedColumns[column],
          },
        };
      },
      updateItem(snapshot: PersistedWorkItemSnapshot, itemId: string, updates: UpdateWorkItemInput) {
        const item = snapshot.items[itemId];
        if (!item) {
          return {
            item: null,
            snapshot,
          };
        }

        const timestamp = normalizeTimestamp(updates.now, new Date().toISOString());
        const nextState = updates.state ? normalizeState(updates.state) : item.state;
        const nextColumn = getColumnForState(nextState);
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

        return {
          item: nextItem,
          snapshot: moveItemWithinSnapshot(snapshot, nextItem, timestamp),
        };
      },
    },
    promptBuilder: {
      buildContextPrompt({ description, title }) {
        const lines = [
          "Work item context:",
          `- Title: ${title}`,
        ];

        if (description?.trim()) {
          lines.push(`- Description: ${description.trim()}`);
        }

        lines.push("", "Start by confirming the task understanding and proposing the next concrete step.");

        return lines.join("\n");
      },
    },
    renderer: {
      renderBoardColumns(snapshot: PersistedWorkItemSnapshot): readonly WorkItemBoardColumn[] {
        return COLUMN_DEFINITIONS.map((columnDefinition) => ({
          id: columnDefinition.id,
          items: snapshot.itemOrderByColumn[columnDefinition.id]
            .map((id) => snapshot.items[id])
            .filter((item): item is WorkItem => Boolean(item))
            .map(renderBoardCard),
          label: columnDefinition.label,
        }));
      },
      renderColumnSummaries(snapshot: PersistedWorkItemSnapshot): readonly WorkItemColumnSummary[] {
        return COLUMN_DEFINITIONS.map((columnDefinition) => ({
          id: columnDefinition.id,
          label: columnDefinition.label,
          count: snapshot.itemOrderByColumn[columnDefinition.id].length,
        }));
      },
      resolveSelectionState(snapshot: PersistedWorkItemSnapshot, selectedItemId: string | null): WorkItemSelectionState {
        const orderedItems = getOrderedItems(snapshot);
        const selectedItem = selectedItemId
          ? orderedItems.find((item) => item.id === selectedItemId) ?? null
          : null;
        const resolvedItem = selectedItem ?? orderedItems[0] ?? null;

        return {
          selectedItem: resolvedItem ? renderBoardCard(resolvedItem) : null,
          selectedItemId: resolvedItem?.id ?? null,
        };
      },
    },
  };
}

function renderBoardCard(item: WorkItem): WorkItemBoardCard {
  return {
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
  };
}

function getOrderedItems(snapshot: PersistedWorkItemSnapshot): readonly WorkItem[] {
  return COLUMN_DEFINITIONS.flatMap((columnDefinition) =>
    snapshot.itemOrderByColumn[columnDefinition.id]
      .map((id) => snapshot.items[id])
      .filter((item): item is WorkItem => Boolean(item))
  );
}

function getColumnForState(state: WorkItemState): WorkItemColumn {
  switch (state) {
    case "priority":
      return "priority";
    case "todo":
      return "todo";
    case "active":
      return "active";
    case "done":
    case "abandoned":
      return "done";
  }
}

function getStateForColumn(column: WorkItemColumn): WorkItemState {
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
