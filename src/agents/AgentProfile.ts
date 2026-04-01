export type AgentKind = "claude" | "copilot";
export type AgentProfileId = "claude" | "claude-context" | "copilot" | "copilot-context";

export interface AgentProfile {
  readonly commandConfigurationKey: string;
  readonly defaultCommand: string;
  readonly extraArgsConfigurationKey: string;
  readonly id: AgentProfileId;
  readonly kind: AgentKind;
  readonly label: string;
  readonly resumeBehaviorLabel: string;
  readonly usesContext: boolean;
}

export interface AgentProfileSummary {
  readonly command: string;
  readonly id: AgentProfileId;
  readonly kind: AgentKind;
  readonly label: string;
  readonly resumeBehaviorLabel: string;
  readonly status: "missing-command" | "ready";
  readonly statusLabel: string;
  readonly usesContext: boolean;
}

const BUILT_IN_AGENT_PROFILES: readonly AgentProfile[] = [
  {
    commandConfigurationKey: "claudeCommand",
    defaultCommand: "claude",
    extraArgsConfigurationKey: "claudeExtraArgs",
    id: "claude",
    kind: "claude",
    label: "Claude",
    resumeBehaviorLabel: "Tracks a launch session id for resume-aware workflows.",
    usesContext: false,
  },
  {
    commandConfigurationKey: "claudeCommand",
    defaultCommand: "claude",
    extraArgsConfigurationKey: "claudeExtraArgs",
    id: "claude-context",
    kind: "claude",
    label: "Claude (ctx)",
    resumeBehaviorLabel: "Tracks a launch session id and sends work item context after launch.",
    usesContext: true,
  },
  {
    commandConfigurationKey: "copilotCommand",
    defaultCommand: "copilot",
    extraArgsConfigurationKey: "copilotExtraArgs",
    id: "copilot",
    kind: "copilot",
    label: "Copilot",
    resumeBehaviorLabel: "Launches GitHub Copilot CLI with the configured command.",
    usesContext: false,
  },
  {
    commandConfigurationKey: "copilotCommand",
    defaultCommand: "copilot",
    extraArgsConfigurationKey: "copilotExtraArgs",
    id: "copilot-context",
    kind: "copilot",
    label: "Copilot (ctx)",
    resumeBehaviorLabel: "Launches GitHub Copilot CLI and sends work item context after launch.",
    usesContext: true,
  },
] as const;

export function getBuiltInAgentProfiles(): readonly AgentProfile[] {
  return BUILT_IN_AGENT_PROFILES;
}

export function getAgentProfileById(profileId: string): AgentProfile | null {
  return BUILT_IN_AGENT_PROFILES.find((profile) => profile.id === profileId) ?? null;
}

export function buildWorkItemContextPrompt(itemTitle: string, itemDescription: string | null): string {
  const lines = [
    "Work item context:",
    `- Title: ${itemTitle}`,
  ];

  if (itemDescription?.trim()) {
    lines.push(`- Description: ${itemDescription.trim()}`);
  }

  lines.push("", "Start by confirming the task understanding and proposing the next concrete step.");

  return lines.join("\n");
}
