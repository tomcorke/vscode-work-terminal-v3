import {
  getBuiltInAgentProfileById,
  getBuiltInAgentProfiles,
  isAgentKind,
  type AgentProfile,
  type AgentProfileIssue,
  type AgentProfileId,
  type SerializedAgentProfile,
} from "./AgentProfile";

export const AGENT_PROFILES_CONFIGURATION_KEY = "agentProfiles";

interface ConfigurationLike {
  get<T>(section: string, defaultValue?: T): T;
}

export interface AgentProfileCatalog {
  readonly issues: readonly AgentProfileIssue[];
  readonly profiles: readonly AgentProfile[];
}

export function loadAgentProfileCatalog(configuration: ConfigurationLike): AgentProfileCatalog {
  const configuredProfiles = configuration.get<unknown>(AGENT_PROFILES_CONFIGURATION_KEY);
  if (configuredProfiles === undefined) {
    return {
      issues: [],
      profiles: buildLegacyBackedProfiles(configuration),
    };
  }

  if (!Array.isArray(configuredProfiles)) {
    return {
      issues: [{ message: "workTerminal.agentProfiles must be an array. Using built-in defaults until the setting is fixed.", profileId: null }],
      profiles: buildLegacyBackedProfiles(configuration),
    };
  }

  const profiles: AgentProfile[] = [];
  const issues: AgentProfileIssue[] = [];
  const seenIds = new Set<string>();

  for (const [index, profileValue] of configuredProfiles.entries()) {
    const normalized = normalizeSerializedAgentProfile(profileValue);
    if (!normalized.profile) {
      issues.push({
        message: `Profile entry ${index + 1}: ${normalized.issue}`,
        profileId: normalized.profileId,
      });
      continue;
    }

    if (seenIds.has(normalized.profile.id)) {
      issues.push({
        message: `Profile "${normalized.profile.id}" is duplicated. Keep each profile id unique.`,
        profileId: normalized.profile.id,
      });
      continue;
    }

    seenIds.add(normalized.profile.id);
    profiles.push(normalized.profile);
  }

  return { issues, profiles };
}

export function getAgentProfileById(
  configuration: ConfigurationLike,
  profileId: AgentProfileId,
): AgentProfile | null {
  return loadAgentProfileCatalog(configuration).profiles.find((profile) => profile.id === profileId) ?? null;
}

export function serializeAgentProfiles(profiles: readonly AgentProfile[]): readonly SerializedAgentProfile[] {
  return profiles.map((profile) => ({
    command: profile.command,
    extraArgs: profile.extraArgs,
    id: profile.id,
    kind: profile.kind,
    label: profile.label,
    usesContext: profile.usesContext,
  }));
}

function buildLegacyBackedProfiles(configuration: ConfigurationLike): readonly AgentProfile[] {
  return getBuiltInAgentProfiles().map((profile) => ({
    ...profile,
    command: getLegacyCommandOverride(configuration, profile),
    extraArgs: getLegacyExtraArgsOverride(configuration, profile),
  }));
}

function getLegacyCommandOverride(
  configuration: ConfigurationLike,
  profile: Pick<AgentProfile, "command" | "kind">,
): string {
  switch (profile.kind) {
    case "claude":
      return normalizeString(configuration.get<string>("claudeCommand", profile.command), profile.command);
    case "copilot":
      return normalizeString(configuration.get<string>("copilotCommand", profile.command), profile.command);
    case "strands":
      return normalizeString(configuration.get<string>("strandsCommand", profile.command), profile.command);
    case "custom":
      return profile.command;
  }
}

function getLegacyExtraArgsOverride(
  configuration: ConfigurationLike,
  profile: Pick<AgentProfile, "extraArgs" | "kind">,
): string {
  switch (profile.kind) {
    case "claude":
      return normalizeString(configuration.get<string>("claudeExtraArgs", profile.extraArgs), profile.extraArgs);
    case "copilot":
      return normalizeString(configuration.get<string>("copilotExtraArgs", profile.extraArgs), profile.extraArgs);
    case "strands":
      return normalizeString(configuration.get<string>("strandsExtraArgs", profile.extraArgs), profile.extraArgs);
    case "custom":
      return profile.extraArgs;
  }
}

function normalizeSerializedAgentProfile(value: unknown): {
  readonly issue: string | null;
  readonly profile: AgentProfile | null;
  readonly profileId: AgentProfileId | null;
} {
  if (!isRecord(value)) {
    return { issue: "must be an object.", profile: null, profileId: null };
  }

  const rawId = asTrimmedString(value.id);
  if (!rawId) {
    return { issue: "is missing a non-empty id.", profile: null, profileId: null };
  }

  const rawLabel = asTrimmedString(value.label);
  if (!rawLabel) {
    return { issue: "must include a non-empty label.", profile: null, profileId: rawId };
  }

  const rawKind = asTrimmedString(value.kind);
  if (!rawKind || !isAgentKind(rawKind)) {
    return {
      issue: `must use one of ${["claude", "copilot", "strands", "custom"].join(", ")} as the kind.`,
      profile: null,
      profileId: rawId,
    };
  }

  const rawCommand = asTrimmedString(value.command);
  if (!rawCommand) {
    return {
      issue: "must include a non-empty command.",
      profile: null,
      profileId: rawId,
    };
  }

  const extraArgs = typeof value.extraArgs === "string" ? value.extraArgs : "";
  const usesContext = typeof value.usesContext === "boolean" ? value.usesContext : false;

  return {
    issue: null,
    profile: {
      builtIn: Boolean(getBuiltInAgentProfileById(rawId)),
      command: rawCommand,
      extraArgs,
      id: rawId,
      kind: rawKind,
      label: rawLabel,
      usesContext,
    },
    profileId: rawId,
  };
}

function normalizeString(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || defaultValue;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
