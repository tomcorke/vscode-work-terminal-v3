import { describe, expect, it } from "vitest";

import { renderWorkTerminalHtml } from "../src/workTerminal/renderWorkTerminalHtml";

describe("renderWorkTerminalHtml", () => {
  it("renders the expected bootstrap shell", () => {
    const selectedItem = {
      blockerReason: null,
      column: "active",
      completedAt: null,
      createdAt: "2026-04-01T09:00:00.000Z",
      description: "Test selection details",
      id: "123e4567-e89b-12d3-a456-426614174000",
      isBlocked: false,
      priorityDeadline: "2026-04-02T10:00:00.000Z",
      priorityLevel: "medium",
      priorityScore: 42,
      sourceCapturedAt: "2026-04-01T09:05:00.000Z",
      sourceExternalId: "ISSUE-24",
      sourceKind: "manual",
      sourcePath: "notes/demo.md",
      sourceUrl: "https://example.invalid/items/24",
      state: "active",
      title: "Demo task",
      updatedAt: "2026-04-01T10:00:00.000Z",
    } as const;
    const html = renderWorkTerminalHtml({
      cspSource: "https://example.invalid",
      nonce: "test-nonce",
      scriptUri: "https://example.invalid/dist/webview/main.js",
      state: {
        agentProfiles: [
          {
            builtIn: true,
            command: "claude",
            id: "claude",
            kind: "claude",
            label: "Claude",
            resumeBehaviorLabel: "Tracks a launch session id for resume-aware workflows.",
            status: "ready",
            statusLabel: "Ready - /usr/local/bin/claude",
            usesContext: false,
          },
        ],
        boardColumns: [
          {
            id: "active",
            items: [selectedItem],
            label: "Active",
          },
        ],
        collapsedColumns: {
          active: false,
          done: false,
          priority: false,
          todo: false,
        },
        columnSummaries: [
          { count: 1, id: "active", label: "Active" },
          { count: 0, id: "todo", label: "To Do" },
        ],
        latestWorkItemTitle: "Demo task",
        profileIssues: [],
        recentlyClosedSessions: [],
        selectedItem,
        selectedItemId: "123e4567-e89b-12d3-a456-426614174000",
        status: "Ready",
        storagePath: "/workspace/.work-terminal/work-items.v1.json",
        terminalSessionCountByItemId: {
          "123e4567-e89b-12d3-a456-426614174000": 1,
        },
        terminalSessions: [
          {
            activityState: "active",
            activityStateLabel: "Recent terminal signal observed",
            command: "claude",
            id: "223e4567-e89b-12d3-a456-426614174000",
            itemDescription: "Test selection details",
            itemId: "123e4567-e89b-12d3-a456-426614174000",
            itemTitle: "Demo task",
            kind: "claude",
            label: "Demo task - Claude",
            profileId: "claude",
            profileLabel: "Claude",
            resumeSessionId: "323e4567-e89b-12d3-a456-426614174000",
            statusLabel: "Ready - /usr/local/bin/claude",
          },
        ],
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
    expect(html).toContain("Claude");
    expect(html).toContain("nonce=\"test-nonce\"");
    expect(html).toContain("https://example.invalid/dist/webview/main.css");
    expect(html).toContain("https://example.invalid/dist/webview/main.js");
    expect(html).toContain("collapsedColumns");
  });

  it("escapes line separator characters in the bootstrapped state", () => {
    const selectedItem = {
      blockerReason: "Waiting on API rollout",
      column: "active",
      completedAt: null,
      createdAt: "2026-04-01T09:00:00.000Z",
      description: "Line\u2028separator and paragraph\u2029separator",
      id: "123e4567-e89b-12d3-a456-426614174000",
      isBlocked: false,
      priorityDeadline: null,
      priorityLevel: "medium",
      priorityScore: 7,
      sourceCapturedAt: null,
      sourceExternalId: null,
      sourceKind: "manual",
      sourcePath: null,
      sourceUrl: null,
      state: "active",
      title: "Demo\u2028task",
      updatedAt: "2026-04-01T10:00:00.000Z",
    } as const;
    const html = renderWorkTerminalHtml({
      cspSource: "https://example.invalid",
      nonce: "test-nonce",
      scriptUri: "https://example.invalid/dist/webview/main.js",
      state: {
        agentProfiles: [],
        boardColumns: [
          {
            id: "active",
            items: [selectedItem],
            label: "Active",
          },
        ],
        collapsedColumns: {
          active: false,
          done: false,
          priority: false,
          todo: false,
        },
        columnSummaries: [{ count: 1, id: "active", label: "Active" }],
        latestWorkItemTitle: "Demo\u2029task",
        profileIssues: [],
        recentlyClosedSessions: [],
        selectedItem,
        selectedItemId: "123e4567-e89b-12d3-a456-426614174000",
        status: "Ready",
        storagePath: null,
        terminalSessionCountByItemId: {},
        terminalSessions: [],
        totalWorkItems: 1,
        workspaceName: "Demo Workspace",
        lastUpdatedLabel: "10:00:00",
      },
      styleUri: "https://example.invalid/dist/webview/main.css",
    });

    expect(html).toContain("\\u2028");
    expect(html).toContain("\\u2029");
    expect(html).not.toContain("Demo\u2028task");
    expect(html).not.toContain("paragraph\u2029separator");
  });
});
