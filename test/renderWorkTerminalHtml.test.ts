import { describe, expect, it } from "vitest";

import { renderWorkTerminalHtml } from "../src/workTerminal/renderWorkTerminalHtml";

describe("renderWorkTerminalHtml", () => {
  it("renders the expected bootstrap shell", () => {
    const html = renderWorkTerminalHtml({
      cspSource: "https://example.invalid",
      nonce: "test-nonce",
      scriptUri: "https://example.invalid/dist/webview/main.js",
      state: {
        boardColumns: [
          {
            id: "active",
            items: [
              {
                description: "Test selection details",
                id: "123e4567-e89b-12d3-a456-426614174000",
                isBlocked: false,
                priorityLevel: "medium",
                sourceKind: "manual",
                title: "Demo task",
                updatedAt: "2026-04-01T10:00:00.000Z",
              },
            ],
            label: "Active",
          },
        ],
        columnSummaries: [
          { count: 1, id: "active", label: "Active" },
          { count: 0, id: "todo", label: "To Do" },
        ],
        latestWorkItemTitle: "Demo task",
        selectedItemId: "123e4567-e89b-12d3-a456-426614174000",
        status: "Ready",
        storagePath: "/tmp/workspace/.work-terminal/work-items.v1.json",
        totalWorkItems: 1,
        workspaceName: "Demo Workspace",
        lastUpdatedLabel: "10:00:00",
      },
      styleUri: "https://example.invalid/dist/webview/main.css",
    });

    expect(html).toContain("Work Terminal");
    expect(html).toContain('id="work-terminal-root"');
    expect(html).toContain("window.__WORK_TERMINAL_INITIAL_STATE__");
    expect(html).toContain("Demo Workspace");
    expect(html).toContain("Demo task");
    expect(html).toContain("nonce=\"test-nonce\"");
    expect(html).toContain("https://example.invalid/dist/webview/main.css");
    expect(html).toContain("https://example.invalid/dist/webview/main.js");
  });
});
