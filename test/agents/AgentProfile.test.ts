import { describe, expect, it } from "vitest";

import {
  buildWorkItemContextPrompt,
  getBuiltInAgentProfileById,
  getBuiltInAgentProfiles,
  getResumeBehaviorLabel,
} from "../../src/agents";

describe("AgentProfile", () => {
  it("exposes the built-in launch profiles including Strands", () => {
    expect(getBuiltInAgentProfiles().map((profile) => profile.id)).toEqual([
      "claude",
      "claude-context",
      "copilot",
      "copilot-context",
      "strands",
      "strands-context",
    ]);
  });

  it("looks up built-in profiles by id", () => {
    expect(getBuiltInAgentProfileById("claude-context")?.usesContext).toBe(true);
    expect(getBuiltInAgentProfileById("missing-profile")).toBeNull();
  });

  it("describes resume behavior for custom and built-in kinds", () => {
    expect(getResumeBehaviorLabel({ kind: "custom", usesContext: false })).toContain("configured agent command");
    expect(getResumeBehaviorLabel({ kind: "strands", usesContext: true })).toContain("sends work item context");
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
