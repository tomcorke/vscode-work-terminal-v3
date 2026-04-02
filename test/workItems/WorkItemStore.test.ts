import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkItemStore } from "../../src/workItems";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("WorkItemStore", () => {
  it("creates and reloads persisted work items", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const created = await store.createWorkItem({
      state: "active",
      title: "Investigate flaky persistence test",
    });

    expect(created?.title).toBe("Investigate flaky persistence test");

    const reloadedStore = new WorkItemStore(workspaceRoot);
    const summary = await reloadedStore.getSummary();
    const snapshotPath = reloadedStore.getStoragePath();

    expect(summary.totalCount).toBe(1);
    expect(summary.latestWorkItemTitle).toBe("Investigate flaky persistence test");
    expect(summary.columnSummaries.find((column) => column.id === "active")?.count).toBe(1);
    expect(snapshotPath).toContain(".work-terminal/work-items.v1.json");

    const snapshotContent = await readFile(snapshotPath!, "utf8");
    expect(snapshotContent).toContain("Investigate flaky persistence test");
  });

  it("serializes concurrent work item creation", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);

    await Promise.all([
      store.createWorkItem({ title: "First concurrent item" }),
      store.createWorkItem({ title: "Second concurrent item" }),
    ]);

    const summary = await store.getSummary();
    expect(summary.totalCount).toBe(2);
  });

  it("recovers from a corrupt snapshot by backing it up", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const snapshotPath = store.getStoragePath();

    await mkdir(dirname(snapshotPath!), { recursive: true });
    await writeFile(snapshotPath!, "{ not valid json\n", "utf8");

    const created = await store.createWorkItem({
      title: "Recovered after corruption",
    });
    const files = await readdir(join(workspaceRoot, ".work-terminal"));

    expect(created?.title).toBe("Recovered after corruption");
    expect(files.some((file) => file.startsWith("work-items.v1.json.corrupt-"))).toBe(true);
  });

  it("does not let a first read overwrite a concurrent create", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);

    await Promise.all([
      store.getSummary(),
      store.createWorkItem({ title: "Created during first read" }),
    ]);

    const summary = await store.getSummary();
    expect(summary.totalCount).toBe(1);
  });

  it("reorders items within a column and persists the result", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const first = await store.createWorkItem({ title: "First item" });
    const second = await store.createWorkItem({ title: "Second item" });

    const reordered = await store.reorderItems(second!.id, "todo", "todo", 1);
    expect(reordered).toBe(true);

    const summary = await store.getSummary();
    expect(summary.boardColumns.find((column) => column.id === "todo")?.items.map((item) => item.title)).toEqual([
      "First item",
      "Second item",
    ]);

    const reloadedStore = new WorkItemStore(workspaceRoot);
    const reloadedSummary = await reloadedStore.getSummary();
    expect(reloadedSummary.boardColumns.find((column) => column.id === "todo")?.items.map((item) => item.title)).toEqual([
      "First item",
      "Second item",
    ]);

    expect(first?.id).not.toBe(second?.id);
  });

  it("moves items across columns and updates persisted state", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const created = await store.createWorkItem({ title: "Move me", state: "todo" });

    const moved = await store.reorderItems(created!.id, "todo", "done", 0);
    expect(moved).toBe(true);

    const reloadedStore = new WorkItemStore(workspaceRoot);
    const snapshot = await reloadedStore.loadSnapshot();
    const movedItem = snapshot.items[created!.id];

    expect(snapshot.itemOrderByColumn.todo).not.toContain(created!.id);
    expect(snapshot.itemOrderByColumn.done[0]).toBe(created!.id);
    expect(movedItem?.column).toBe("done");
    expect(movedItem?.state).toBe("done");
    expect(movedItem?.completedAt).not.toBeNull();
  });

  it("updates work item details and rich metadata", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const created = await store.createWorkItem({
      description: "Original description",
      priority: {
        isBlocked: true,
        level: "medium",
        score: 20,
      },
      source: {
        kind: "manual",
      },
      title: "Original title",
    });

    const updated = await store.updateWorkItem(created!.id, {
      description: "Updated description",
      priority: {
        blockerReason: "Waiting on API rollout",
        deadline: "2026-04-03T10:00:00.000Z",
        isBlocked: true,
        level: "critical",
        score: 88,
      },
      source: {
        externalId: "ISSUE-24",
        kind: "jira",
        path: "notes/issue-24.md",
        url: "https://example.invalid/issues/24",
      },
      title: "Updated title",
    });

    expect(updated?.title).toBe("Updated title");

    const summary = await store.getSummary();
    const updatedCard = summary.boardColumns.find((column) => column.id === "todo")?.items[0];
    expect(updatedCard).toMatchObject({
      blockerReason: "Waiting on API rollout",
      priorityDeadline: "2026-04-03T10:00:00.000Z",
      priorityLevel: "critical",
      priorityScore: 88,
      sourceExternalId: "ISSUE-24",
      sourceKind: "jira",
      sourcePath: "notes/issue-24.md",
      sourceUrl: "https://example.invalid/issues/24",
      title: "Updated title",
    });
  });

  it("moves items with a targeted mutation helper", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const created = await store.createWorkItem({ title: "Move from action menu", state: "todo" });

    const moved = await store.moveItemToColumn(created!.id, "active");

    expect(moved?.column).toBe("active");

    const snapshot = await store.loadSnapshot();
    expect(snapshot.items[created!.id]?.column).toBe("active");
    expect(snapshot.itemOrderByColumn.active[0]).toBe(created!.id);
  });

  it("splits a work item and preserves useful metadata", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const parent = await store.createWorkItem({
      description: "Parent item context",
      priority: {
        blockerReason: "Need platform approval",
        deadline: "2026-04-05T11:00:00.000Z",
        isBlocked: true,
        level: "high",
        score: 72,
      },
      source: {
        externalId: "ISSUE-24",
        kind: "jira",
        url: "https://example.invalid/issues/24",
      },
      state: "active",
      title: "Parent task",
    });

    const split = await store.splitWorkItem(parent!.id, {
      description: "   ",
      title: "Child task",
    });

    expect(split?.title).toBe("Child task");
    expect(split?.description).toContain('Split from "Parent task".');
    expect(split?.priority.level).toBe("high");
    expect(split?.source.externalId).toBe("ISSUE-24");

    const summary = await store.getSummary();
    expect(summary.boardColumns.find((column) => column.id === "active")?.items.map((item) => item.title)).toEqual([
      "Parent task",
      "Child task",
    ]);
  });

  it("deletes work items and removes them from persisted ordering", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const first = await store.createWorkItem({ title: "Keep me" });
    const second = await store.createWorkItem({ title: "Delete me" });

    const deleted = await store.deleteWorkItem(second!.id);

    expect(deleted).toBe(true);

    const snapshot = await store.loadSnapshot();
    expect(snapshot.items[second!.id]).toBeUndefined();
    expect(snapshot.itemOrderByColumn.todo).toEqual([first!.id]);
  });

  it("toggles collapsed column state and persists it", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const toggled = await store.toggleColumnCollapsed("active");
    expect(toggled).toBe(true);

    const summary = await store.getSummary();
    expect(summary.collapsedColumns.active).toBe(true);

    const reloadedStore = new WorkItemStore(workspaceRoot);
    const reloadedSummary = await reloadedStore.getSummary();
    expect(reloadedSummary.collapsedColumns.active).toBe(true);
  });

  it("preserves abandoned state when reordering inside the done column", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    const activeItem = await store.createWorkItem({ title: "Done item", state: "done" });
    const abandonedItem = await store.createWorkItem({ title: "Abandoned item", state: "abandoned" });

    const reordered = await store.reorderItems(abandonedItem!.id, "done", "done", 1);
    expect(reordered).toBe(true);

    const snapshot = await store.loadSnapshot();
    expect(snapshot.items[abandonedItem!.id]?.state).toBe("abandoned");
    expect(snapshot.items[activeItem!.id]?.state).toBe("done");
  });

  it("resolves selected item detail state through the adapter renderer", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-store-"));
    tempDirectories.push(workspaceRoot);

    const store = new WorkItemStore(workspaceRoot);
    await store.createWorkItem({ title: "First item" });
    const second = await store.createWorkItem({
      description: "Preferred detail selection",
      priority: {
        blockerReason: "Waiting on review",
        isBlocked: true,
        level: "high",
        score: 55,
      },
      title: "Second item",
    });

    const selectedSummary = await store.getSummary(second!.id);
    expect(selectedSummary.selectedItemId).toBe(second!.id);
    expect(selectedSummary.selectedItem).toMatchObject({
      blockerReason: "Waiting on review",
      id: second!.id,
      isBlocked: true,
      title: "Second item",
    });

    const fallbackSummary = await store.getSummary("missing-id");
    const expectedFallbackId = fallbackSummary.boardColumns.flatMap((column) => column.items)[0]?.id ?? null;
    expect(fallbackSummary.selectedItemId).toBe(expectedFallbackId);
    expect(fallbackSummary.selectedItem?.id).toBe(expectedFallbackId);
  });
});
