import { describe, expect, it } from "vitest";

import {
  buildWorkItemContextPrompt,
  getAgentProfileById,
  getBuiltInAgentProfiles,
} from "../../src/agents";

describe("AgentProfile", () => {
  it("exposes the built-in launch profiles", () => {
    expect(getBuiltInAgentProfiles().map((profile) => profile.id)).toEqual([
      "claude",
      "claude-context",
      "copilot",
      "copilot-context",
    ]);
  });

  it("looks up profiles by id", () => {
    expect(getAgentProfileById("claude-context")?.usesContext).toBe(true);
    expect(getAgentProfileById("missing-profile")).toBeNull();
  });

  it("builds a work item context prompt with a description", () => {
    expect(buildWorkItemContextPrompt("Fix flaky test", "Investigate CI failures")).toContain(
      "- Description: Investigate CI failures",
    );
  });

  it("omits the description line when none is present", () => {
    expect(buildWorkItemContextPrompt("Fix flaky test", null)).not.toContain("- Description:");
  });
});
