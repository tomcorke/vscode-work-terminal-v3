import { describe, expect, it } from "vitest";

import {
  loadAgentProfileCatalog,
  serializeAgentProfiles,
  type AgentProfile,
} from "../../src/agents";

describe("AgentProfileConfiguration", () => {
  it("falls back to built-in profiles when the custom setting is unset", () => {
    const catalog = loadAgentProfileCatalog({
      get<T>(section: string, defaultValue?: T): T {
        const values: Record<string, string | undefined> = {
          claudeCommand: "claude-dev",
          strandsCommand: "strands-dev",
        };
        return ((values[section] as T | undefined) ?? defaultValue) as T;
      },
    });

    expect(catalog.issues).toEqual([]);
    expect(catalog.profiles.find((profile) => profile.id === "claude")?.command).toBe("claude-dev");
    expect(catalog.profiles.find((profile) => profile.id === "strands")?.command).toBe("strands-dev");
  });

  it("loads custom profiles in order and preserves built-in ids", () => {
    const catalog = loadAgentProfileCatalog({
      get<T>(section: string, defaultValue?: T): T {
        if (section === "agentProfiles") {
          return [
            {
              command: "claude --dangerous",
              id: "claude",
              kind: "claude",
              label: "Claude override",
              usesContext: true,
            },
            {
              command: "team-agent",
              extraArgs: "--fast",
              id: "team-agent",
              kind: "custom",
              label: "Team agent",
            },
          ] as T;
        }

        return defaultValue as T;
      },
    });

    expect(catalog.issues).toEqual([]);
    expect(catalog.profiles.map((profile) => profile.id)).toEqual(["claude", "team-agent"]);
    expect(catalog.profiles[0]?.builtIn).toBe(true);
    expect(catalog.profiles[1]?.builtIn).toBe(false);
  });

  it("reports invalid profiles and skips duplicates", () => {
    const catalog = loadAgentProfileCatalog({
      get<T>(section: string, defaultValue?: T): T {
        if (section === "agentProfiles") {
          return [
            { command: "", id: "broken", kind: "custom", label: "Broken" },
            { command: "custom", id: "dup", kind: "custom", label: "First" },
            { command: "custom", id: "dup", kind: "custom", label: "Second" },
          ] as T;
        }

        return defaultValue as T;
      },
    });

    expect(catalog.profiles.map((profile) => profile.id)).toEqual(["dup"]);
    expect(catalog.issues).toEqual([
      expect.objectContaining({ message: expect.stringContaining("must include a non-empty command"), profileId: "broken" }),
      expect.objectContaining({ message: expect.stringContaining("duplicated"), profileId: "dup" }),
    ]);
  });

  it("serializes profiles for settings persistence", () => {
    const profiles: readonly AgentProfile[] = [
      {
        builtIn: false,
        command: "custom-agent",
        extraArgs: "--fast",
        id: "team-agent",
        kind: "custom",
        label: "Team agent",
        usesContext: true,
      },
    ];

    expect(serializeAgentProfiles(profiles)).toEqual([
      {
        command: "custom-agent",
        extraArgs: "--fast",
        id: "team-agent",
        kind: "custom",
        label: "Team agent",
        usesContext: true,
      },
    ]);
  });
});
