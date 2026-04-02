import { describe, expect, it } from "vitest";

import {
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
});
