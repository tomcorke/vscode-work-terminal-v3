export const AGENT_KINDS = ["claude", "copilot", "strands", "custom"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];
export type AgentProfileId = string;

export interface AgentProfile {
  readonly builtIn: boolean;
  readonly command: string;
  readonly extraArgs: string;
  readonly id: AgentProfileId;
  readonly kind: AgentKind;
  readonly label: string;
  readonly usesContext: boolean;
  readonly workingDirectory?: string;
}

export interface ConfigurationIssue {
  readonly message: string;
  readonly profileId: AgentProfileId | null;
  readonly settingPath: string;
}

export interface AgentProfileSummary extends AgentProfile {
  readonly resumeBehaviorLabel: string;
  readonly status: "invalid-configuration" | "missing-command" | "ready";
  readonly statusLabel: string;
  readonly workingDirectoryLabel: string;
}

export interface SerializedAgentProfile {
  readonly command: string;
  readonly extraArgs?: string;
  readonly id: AgentProfileId;
  readonly kind: AgentKind;
  readonly label: string;
  readonly usesContext?: boolean;
  readonly workingDirectory?: string;
}

const BUILT_IN_AGENT_PROFILES: readonly AgentProfile[] = [
  {
    builtIn: true,
    command: "claude",
    extraArgs: "",
    id: "claude",
    kind: "claude",
    label: "Claude",
    usesContext: false,
  },
  {
    builtIn: true,
    command: "claude",
    extraArgs: "",
    id: "claude-context",
    kind: "claude",
    label: "Claude (ctx)",
    usesContext: true,
  },
  {
    builtIn: true,
    command: "copilot",
    extraArgs: "",
    id: "copilot",
    kind: "copilot",
    label: "Copilot",
    usesContext: false,
  },
  {
    builtIn: true,
    command: "copilot",
    extraArgs: "",
    id: "copilot-context",
    kind: "copilot",
    label: "Copilot (ctx)",
    usesContext: true,
  },
  {
    builtIn: true,
    command: "strands",
    extraArgs: "",
    id: "strands",
    kind: "strands",
    label: "Strands",
    usesContext: false,
  },
  {
    builtIn: true,
    command: "strands",
    extraArgs: "",
    id: "strands-context",
    kind: "strands",
    label: "Strands (ctx)",
    usesContext: true,
  },
] as const;

export function getBuiltInAgentProfiles(): readonly AgentProfile[] {
  return BUILT_IN_AGENT_PROFILES.map((profile) => ({ ...profile }));
}

export function getBuiltInAgentProfileById(profileId: string): AgentProfile | null {
  return BUILT_IN_AGENT_PROFILES.find((profile) => profile.id === profileId) ?? null;
}

export function isAgentKind(value: string): value is AgentKind {
  return AGENT_KINDS.includes(value as AgentKind);
}

export function getResumeBehaviorLabel(profile: Pick<AgentProfile, "kind" | "usesContext">): string {
  switch (profile.kind) {
    case "claude":
      return profile.usesContext
        ? "Tracks a launch session id and sends work item context after launch."
        : "Tracks a launch session id for resume-aware workflows.";
    case "copilot":
      return profile.usesContext
        ? "Launches GitHub Copilot CLI and sends work item context after launch."
        : "Launches GitHub Copilot CLI with the configured command.";
    case "strands":
      return profile.usesContext
        ? "Launches Strands and sends work item context after launch."
        : "Launches Strands with the configured command.";
    case "custom":
      return profile.usesContext
        ? "Launches the configured agent command and sends work item context after launch."
        : "Launches the configured agent command.";
  }
}
