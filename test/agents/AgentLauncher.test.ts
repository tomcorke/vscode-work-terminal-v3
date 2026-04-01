import { describe, expect, it } from "vitest";

import {
  buildAgentLaunchPlan,
  getBuiltInAgentProfiles,
  splitConfiguredCommand,
} from "../../src/agents";

describe("AgentLauncher", () => {
  it("splits configured commands with quoted arguments", () => {
    expect(splitConfiguredCommand('node "/tmp/My Tool/runner.js" --flag')).toEqual([
      "node",
      "/tmp/My Tool/runner.js",
      "--flag",
    ]);
  });

  it("builds a Claude launch plan with session id support", () => {
    const profile = getBuiltInAgentProfiles().find((candidate) => candidate.id === "claude");
    expect(profile).toBeDefined();

    const plan = buildAgentLaunchPlan({
      configuredCommand: "claude",
      configuredExtraArgs: "--dangerously-skip-permissions",
      contextPrompt: null,
      profile: profile!,
    });

    expect(plan.executable).toBe("claude");
    expect(plan.args).toContain("--dangerously-skip-permissions");
    expect(plan.args).toContain("--session-id");
    expect(plan.sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(plan.initialPrompt).toBeNull();
  });

  it("builds a context launch plan that sends the prompt after launch", () => {
    const profile = getBuiltInAgentProfiles().find((candidate) => candidate.id === "copilot-context");
    expect(profile).toBeDefined();

    const plan = buildAgentLaunchPlan({
      configuredCommand: "copilot chat",
      configuredExtraArgs: "--model gpt-5",
      contextPrompt: "Work item context",
      profile: profile!,
    });

    expect(plan.executable).toBe("copilot");
    expect(plan.args).toEqual(["chat", "--model", "gpt-5"]);
    expect(plan.initialPrompt).toBe("Work item context");
    expect(plan.sessionId).toBeNull();
  });
});
