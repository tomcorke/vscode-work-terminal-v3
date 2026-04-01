import { describe, expect, it } from "vitest";

import {
  buildAgentLaunchPlan,
  getAgentProfileSummaries,
  getBuiltInAgentProfiles,
  splitConfiguredCommand,
} from "../../src/agents";

describe("AgentLauncher", () => {
  it("splits configured commands with quoted arguments", () => {
    expect(splitConfiguredCommand('node "workspace/My Tool/runner.js" --flag')).toEqual([
      "node",
      "workspace/My Tool/runner.js",
      "--flag",
    ]);
  });

  it("builds a Claude launch plan with session id support", () => {
    const profile = getBuiltInAgentProfiles().find((candidate) => candidate.id === "claude");
    expect(profile).toBeDefined();

    const plan = buildAgentLaunchPlan({
      contextPrompt: null,
      profile: {
        ...profile!,
        command: "claude",
        extraArgs: "--dangerously-skip-permissions",
      },
    });

    expect(plan.executable).toBe("claude");
    expect(plan.args).toContain("--dangerously-skip-permissions");
    expect(plan.args).toContain("--session-id");
    expect(plan.sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(plan.initialPrompt).toBeNull();
  });

  it("builds a Strands context launch plan that sends the prompt after launch", () => {
    const profile = getBuiltInAgentProfiles().find((candidate) => candidate.id === "strands-context");
    expect(profile).toBeDefined();

    const plan = buildAgentLaunchPlan({
      contextPrompt: "Work item context",
      profile: {
        ...profile!,
        command: "strands chat",
        extraArgs: "--model fast",
      },
    });

    expect(plan.executable).toBe("strands");
    expect(plan.args).toEqual(["chat", "--model", "fast"]);
    expect(plan.initialPrompt).toBe("Work item context");
    expect(plan.sessionId).toBeNull();
  });

  it("marks multi-token launch commands as ready when the executable exists", () => {
    const summaries = getAgentProfileSummaries([
      {
        builtIn: false,
        command: `node ./node_modules/vitest/vitest.mjs`,
        extraArgs: "run",
        id: "team-agent",
        kind: "custom",
        label: "Team agent",
        usesContext: false,
      },
    ]);

    expect(summaries[0]).toEqual(expect.objectContaining({ status: "ready" }));
  });

  it("surfaces invalid configuration when the command is blank", () => {
    const summaries = getAgentProfileSummaries([
      {
        builtIn: false,
        command: "   ",
        extraArgs: "",
        id: "broken",
        kind: "custom",
        label: "Broken",
        usesContext: false,
      },
    ]);

    expect(summaries[0]).toEqual(expect.objectContaining({
      status: "invalid-configuration",
      statusLabel: expect.stringContaining("Invalid configuration"),
    }));
  });
});
