import { describe, expect, it } from "vitest";

import {
  buildAgentLaunchPlan,
  getAgentProfileSummaries,
  getBuiltInAgentProfiles,
  getNormalizedConfiguredCommand,
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

  it("normalizes whitespace-only commands back to the default executable", () => {
    expect(getNormalizedConfiguredCommand("   ", "copilot")).toBe("copilot");
  });

  it("marks multi-token launch commands as ready when the executable exists", () => {
    const profile = getBuiltInAgentProfiles().find((candidate) => candidate.id === "copilot");
    expect(profile).toBeDefined();

    const summaries = getAgentProfileSummaries({
      get<T>(section: string, defaultValue?: T): T {
        if (section === profile!.commandConfigurationKey) {
          return "node ./node_modules/vitest/vitest.mjs" as T;
        }

        return defaultValue as T;
      },
    });

    expect(summaries.find((summary) => summary.id === "copilot")?.status).toBe("ready");
  });
});
