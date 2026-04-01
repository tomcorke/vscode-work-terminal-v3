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
});
