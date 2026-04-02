import { describe, expect, it, vi } from "vitest";

import type { WorkItemWorkflowStore, WorkItemStoreSummary } from "../../src/workItems";

const getConfiguration = vi.fn(() => ({
  update: vi.fn(),
}));

vi.mock("vscode", () => {
  class Disposable {
    public constructor(private readonly callback: () => void) {}

    public dispose(): void {
      this.callback();
    }
  }

  class EventEmitter<T> {
    private readonly listeners = new Set<(value: T) => void>();

    public get event(): (listener: (value: T) => void) => Disposable {
      return (listener) => {
        this.listeners.add(listener);
        return new Disposable(() => {
          this.listeners.delete(listener);
        });
      };
    }

    public fire(value: T): void {
      for (const listener of this.listeners) {
        listener(value);
      }
    }

    public dispose(): void {
      this.listeners.clear();
    }
  }

  return {
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
    },
    Disposable,
    EventEmitter,
    Uri: {
      joinPath: (...segments: Array<{ readonly path?: string } | string>) => ({
        path: segments.map((segment) => typeof segment === "string" ? segment : segment.path ?? "").join("/"),
        toString() {
          return this.path;
        },
      }),
    },
    window: {
      createTerminal: vi.fn((options: { readonly name?: string } | undefined) => ({
        dispose: vi.fn(),
        name: options?.name ?? "Terminal",
        sendText: vi.fn(),
        show: vi.fn(),
        state: {
          isInteractedWith: false,
        },
      })),
      onDidChangeTerminalState: vi.fn(() => new Disposable(() => {})),
      onDidCloseTerminal: vi.fn(() => new Disposable(() => {})),
      terminals: [],
    },
    workspace: {
      getConfiguration,
      name: "Demo workspace",
      workspaceFolders: [{ name: "Demo workspace", uri: { fsPath: "/workspace" } }],
    },
  };
});

describe("WorkTerminalViewProvider", () => {
  it("uses adapter-resolved selection state from the workflow store", async () => {
    const { WorkTerminalViewProvider } = await import("../../src/workTerminal/WorkTerminalViewProvider");

    const summary: WorkItemStoreSummary = {
      boardColumns: [
        {
          id: "todo",
          items: [
            {
              blockerReason: null,
              column: "todo",
              completedAt: null,
              createdAt: "2026-04-01T09:00:00.000Z",
              description: "Visible board card",
              id: "item-a",
              isBlocked: false,
              priorityDeadline: null,
              priorityLevel: "medium",
              priorityScore: 20,
              sourceCapturedAt: null,
              sourceExternalId: null,
              sourceKind: "manual",
              sourcePath: null,
              sourceUrl: null,
              state: "todo",
              title: "Item A",
              updatedAt: "2026-04-01T10:00:00.000Z",
            },
          ],
          label: "To Do",
        },
      ],
      collapsedColumns: {
        active: false,
        done: false,
        priority: false,
        todo: false,
      },
      columnSummaries: [{ count: 1, id: "todo", label: "To Do" }],
      latestWorkItemTitle: "Item A",
      selectedItem: {
        blockerReason: "Adapter-chosen detail",
        column: "todo",
        completedAt: null,
        createdAt: "2026-04-01T09:30:00.000Z",
        description: "Resolved by adapter selection logic",
        id: "item-b",
        isBlocked: true,
        priorityDeadline: null,
        priorityLevel: "high",
        priorityScore: 88,
        sourceCapturedAt: null,
        sourceExternalId: "ISSUE-25",
        sourceKind: "jira",
        sourcePath: null,
        sourceUrl: "https://example.invalid/issues/25",
        state: "active",
        title: "Adapter detail item",
        updatedAt: "2026-04-01T11:00:00.000Z",
      },
      selectedItemId: "item-b",
      storagePath: "/workspace/.work-terminal/work-items.v1.json",
      totalCount: 2,
    };
    const store: WorkItemWorkflowStore = {
      createWorkItem: vi.fn(),
      deleteWorkItem: vi.fn(),
      getColumnDefinitions: vi.fn(() => []),
      getColumnLabel: vi.fn((column: string) => column),
      getSummary: vi.fn(async () => summary),
      getWorkItem: vi.fn(),
      moveItemToColumn: vi.fn(),
      reorderItems: vi.fn(),
      splitWorkItem: vi.fn(),
      toggleColumnCollapsed: vi.fn(),
      updateWorkItem: vi.fn(),
    };
    const terminalStore = {
      getSummary: vi.fn(() => ({
        agentProfiles: [],
        profileIssues: [],
        recentlyClosedSessions: [],
        sessionCountByItemId: {},
        sessions: [],
      })),
      onDidChangeSessions: vi.fn(() => ({ dispose() {} })),
    };

    const provider = new WorkTerminalViewProvider(
      { path: "/extension" } as never,
      [],
      store,
      terminalStore as never,
    );

    const state = await (provider as unknown as { createViewState(status: string): Promise<Record<string, unknown>> }).createViewState("Ready");

    expect(store.getSummary).toHaveBeenCalledWith(null);
    expect(state.selectedItemId).toBe("item-b");
    expect(state.selectedItem).toMatchObject({
      blockerReason: "Adapter-chosen detail",
      id: "item-b",
      title: "Adapter detail item",
    });
  });
});
