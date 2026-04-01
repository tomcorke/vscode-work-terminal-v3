import { mkdtemp, readFile, rm } from "node:fs/promises";
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
});
