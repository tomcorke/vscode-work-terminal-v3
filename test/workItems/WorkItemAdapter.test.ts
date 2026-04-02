import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBuiltInJsonWorkItemSourceAdapter,
  WorkItemStore,
  type WorkItemColumnDefinition,
} from "../../src/workItems";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("work item adapters", () => {
  it("builds context prompts through the built-in adapter prompt builder", () => {
    const adapter = createBuiltInJsonWorkItemSourceAdapter();

    expect(adapter.promptBuilder.buildContextPrompt({
      description: "Investigate CI failures",
      title: "Fix flaky test",
    })).toContain("- Description: Investigate CI failures");
    expect(adapter.promptBuilder.buildContextPrompt({
      description: null,
      title: "Fix flaky test",
    })).not.toContain("- Description:");
  });

  it("renders board summaries through the injected adapter abstraction", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "work-terminal-adapter-store-"));
    tempDirectories.push(workspaceRoot);

    const builtInAdapter = createBuiltInJsonWorkItemSourceAdapter();
    const customColumns: readonly WorkItemColumnDefinition[] = [
      { id: "priority", label: "Queue" },
      { id: "todo", label: "Planned" },
      { id: "active", label: "Doing" },
      { id: "done", label: "Shipped" },
    ];
    const renderBoardColumns = vi.fn((snapshot) => builtInAdapter.renderer.renderBoardColumns(snapshot).map((column) => ({
      ...column,
      label: customColumns.find((customColumn) => customColumn.id === column.id)?.label ?? column.label,
    })));
    const renderColumnSummaries = vi.fn((snapshot) => builtInAdapter.renderer.renderColumnSummaries(snapshot).map((column) => ({
      ...column,
      label: customColumns.find((customColumn) => customColumn.id === column.id)?.label ?? column.label,
    })));
    const resolveSelectionState = vi.fn((snapshot, selectedItemId) =>
      builtInAdapter.renderer.resolveSelectionState(snapshot, selectedItemId)
    );

    const store = new WorkItemStore(workspaceRoot, {
      ...builtInAdapter,
      config: {
        ...builtInAdapter.config,
        getColumnDefinitions: () => customColumns,
      },
      renderer: {
        renderBoardColumns,
        renderColumnSummaries,
        resolveSelectionState,
      },
    });

    await store.createWorkItem({ title: "Use adapter labels" });
    const summary = await store.getSummary();

    expect(renderBoardColumns).toHaveBeenCalledTimes(1);
    expect(renderColumnSummaries).toHaveBeenCalledTimes(1);
    expect(resolveSelectionState).toHaveBeenCalledWith(expect.anything(), null);
    expect(summary.boardColumns.find((column) => column.id === "todo")?.label).toBe("Planned");
    expect(summary.columnSummaries.find((column) => column.id === "done")?.label).toBe("Shipped");
    expect(store.getColumnLabel("active")).toBe("Doing");
  });
});
