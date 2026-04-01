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
});
