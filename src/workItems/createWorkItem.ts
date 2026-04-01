import {
  DEFAULT_WORK_ITEM_PRIORITY_LEVEL,
  DEFAULT_WORK_ITEM_STATE,
  WORK_ITEM_STATE_TO_COLUMN,
  type WorkItemPriorityLevel,
  type WorkItemSourceKind,
  type WorkItemState,
} from "./constants";
import type { CreateWorkItemInput, WorkItem, WorkItemId } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createWorkItem(input: CreateWorkItemInput): WorkItem {
  const title = normalizeRequiredTitle(input.title);
  const timestamp = normalizeTimestamp(input.now);
  const state = normalizeWorkItemState(input.state);
  const id = normalizeWorkItemId(input.id) ?? createWorkItemId();

  return {
    id,
    title,
    description: normalizeOptionalString(input.description),
    state,
    column: WORK_ITEM_STATE_TO_COLUMN[state],
    source: {
      kind: normalizeSourceKind(input.source?.kind),
      externalId: normalizeOptionalString(input.source?.externalId),
      url: normalizeOptionalString(input.source?.url),
      path: normalizeOptionalString(input.source?.path),
      fingerprint: normalizeOptionalString(input.source?.fingerprint),
      capturedAt: normalizeOptionalString(input.source?.capturedAt),
    },
    priority: {
      level: normalizePriorityLevel(input.priority?.level),
      score: normalizePriorityScore(input.priority?.score),
      deadline: normalizeOptionalString(input.priority?.deadline),
      isBlocked: Boolean(input.priority?.isBlocked),
      blockerReason: normalizeOptionalString(input.priority?.blockerReason),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: isTerminalState(state) ? timestamp : null,
  };
}

export function createWorkItemId(): WorkItemId {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (!uuid) {
    throw new Error("Work item id generation requires crypto.randomUUID().");
  }

  return uuid;
}

export function isValidWorkItemId(value: unknown): value is WorkItemId {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeWorkItemId(value: unknown): WorkItemId | null {
  return isValidWorkItemId(value) ? value : null;
}

export function normalizeTimestamp(value: string | Date | undefined, fallback?: string): string {
  const candidate = value instanceof Date ? value.toISOString() : value;
  const date = candidate ? new Date(candidate) : null;

  if (date && !Number.isNaN(date.valueOf())) {
    return date.toISOString();
  }

  return fallback ?? new Date().toISOString();
}

export function normalizeWorkItemState(value: unknown): WorkItemState {
  return value === "priority" ||
    value === "todo" ||
    value === "active" ||
    value === "done" ||
    value === "abandoned"
    ? value
    : DEFAULT_WORK_ITEM_STATE;
}

export function normalizePriorityLevel(value: unknown): WorkItemPriorityLevel {
  return value === "none" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
    ? value
    : DEFAULT_WORK_ITEM_PRIORITY_LEVEL;
}

export function normalizeSourceKind(value: unknown): WorkItemSourceKind {
  return value === "manual" ||
    value === "prompt" ||
    value === "jira" ||
    value === "slack" ||
    value === "confluence" ||
    value === "markdown" ||
    value === "other"
    ? value
    : "manual";
}

export function normalizePriorityScore(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  const bounded = Math.max(0, Math.min(100, value));
  return Math.round(bounded);
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRequiredTitle(value: string): string {
  const title = normalizeOptionalString(value);

  if (!title) {
    throw new Error("Work items require a non-empty title.");
  }

  return title;
}

function isTerminalState(state: WorkItemState): boolean {
  return state === "done" || state === "abandoned";
}
