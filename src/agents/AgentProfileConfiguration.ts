import {
  type ConfigurationIssue,
  getBuiltInAgentProfileById,
  getBuiltInAgentProfiles,
  isAgentKind,
  type AgentProfile,
  type AgentProfileId,
  type SerializedAgentProfile,
} from "./AgentProfile";

export const AGENT_PROFILES_CONFIGURATION_KEY = "agentProfiles";

interface ConfigurationLike {
  get<T>(section: string, defaultValue?: T): T;
}

export interface AgentProfileCatalog {
  readonly issues: readonly ConfigurationIssue[];
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
      issues: [{
        message: "Must be an array. Using built-in defaults until the setting is fixed.",
        profileId: null,
        settingPath: "workTerminal.agentProfiles",
      }],
      profiles: buildLegacyBackedProfiles(configuration),
    };
  }

  const profiles: AgentProfile[] = [];
  const issues: ConfigurationIssue[] = [];
  const seenIds = new Set<string>();

  for (const [index, profileValue] of configuredProfiles.entries()) {
    const normalized = normalizeSerializedAgentProfile(profileValue, index);
    if (!normalized.profile) {
      if (!normalized.issue) {
        continue;
      }
      issues.push({
        message: normalized.issue,
        profileId: normalized.profileId,
        settingPath: normalized.settingPath,
      });
      continue;
    }

    if (seenIds.has(normalized.profile.id)) {
      issues.push({
        message: `Profile "${normalized.profile.id}" is duplicated. Keep each profile id unique.`,
        profileId: normalized.profile.id,
        settingPath: `workTerminal.agentProfiles[${index}].id`,
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
    workingDirectory: profile.workingDirectory,
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

function normalizeSerializedAgentProfile(value: unknown, index: number): {
  readonly issue: string;
  readonly profile: AgentProfile | null;
  readonly profileId: AgentProfileId | null;
  readonly settingPath: string;
} {
  const baseSettingPath = `workTerminal.agentProfiles[${index}]`;
  if (!isRecord(value)) {
    return { issue: "Profile entries must be objects.", profile: null, profileId: null, settingPath: baseSettingPath };
  }

  const rawId = asTrimmedString(value.id);
  if (!rawId) {
    return {
      issue: "Each profile must include a non-empty id.",
      profile: null,
      profileId: null,
      settingPath: `${baseSettingPath}.id`,
    };
  }

  const rawLabel = asTrimmedString(value.label);
  if (!rawLabel) {
    return {
      issue: `Profile "${rawId}" must include a non-empty label.`,
      profile: null,
      profileId: rawId,
      settingPath: `${baseSettingPath}.label`,
    };
  }

  const rawKind = asTrimmedString(value.kind);
  if (!rawKind || !isAgentKind(rawKind)) {
    return {
      issue: `Profile "${rawId}" must use one of ${["claude", "copilot", "strands", "custom"].join(", ")} as the kind.`,
      profile: null,
      profileId: rawId,
      settingPath: `${baseSettingPath}.kind`,
    };
  }

  const rawCommand = asTrimmedString(value.command);
  if (!rawCommand) {
    return {
      issue: `Profile "${rawId}" must include a non-empty command.`,
      profile: null,
      profileId: rawId,
      settingPath: `${baseSettingPath}.command`,
    };
  }

  const workingDirectory = typeof value.workingDirectory === "string"
    ? value.workingDirectory.trim() || undefined
    : undefined;
  if (value.workingDirectory !== undefined && typeof value.workingDirectory !== "string") {
    return {
      issue: `Profile "${rawId}" must use a string workingDirectory when set.`,
      profile: null,
      profileId: rawId,
      settingPath: `${baseSettingPath}.workingDirectory`,
    };
  }

  const extraArgs = typeof value.extraArgs === "string" ? value.extraArgs : "";
  const usesContext = typeof value.usesContext === "boolean" ? value.usesContext : false;

  return {
    issue: "",
    profile: {
      builtIn: Boolean(getBuiltInAgentProfileById(rawId)),
      command: rawCommand,
      extraArgs,
      id: rawId,
      kind: rawKind,
      label: rawLabel,
      usesContext,
      workingDirectory,
    },
    profileId: rawId,
    settingPath: baseSettingPath,
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
