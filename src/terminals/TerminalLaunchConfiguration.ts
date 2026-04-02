import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  type AgentProfile,
  type ConfigurationIssue,
  validateConfiguredCommand,
} from "../agents";

export const DEFAULT_WORKING_DIRECTORY_CONFIGURATION_KEY = "defaultWorkingDirectory";
export const SHELL_COMMAND_CONFIGURATION_KEY = "shellCommand";
export const SHELL_EXTRA_ARGS_CONFIGURATION_KEY = "shellExtraArgs";

interface ConfigurationLike {
  get<T>(section: string, defaultValue?: T): T;
}

export interface TerminalLaunchConfigurationSummary {
  readonly defaultWorkingDirectory: string | undefined;
  readonly defaultWorkingDirectoryLabel: string;
  readonly issues: readonly ConfigurationIssue[];
  readonly shellArgs: readonly string[];
  readonly shellCommand: string | null;
  readonly shellExecutable: string | undefined;
  readonly shellStatusLabel: string;
}

export interface ResolvedWorkingDirectory {
  readonly error: ConfigurationIssue | null;
  readonly label: string;
  readonly path: string | undefined;
}

export function loadTerminalLaunchConfiguration(
  configuration: ConfigurationLike,
  workspaceRootPath: string | null,
): TerminalLaunchConfigurationSummary {
  const issues: ConfigurationIssue[] = [];
  const defaultWorkingDirectory = resolveConfiguredWorkingDirectory(
    configuration.get<string>(DEFAULT_WORKING_DIRECTORY_CONFIGURATION_KEY, ""),
    workspaceRootPath,
    "workTerminal.defaultWorkingDirectory",
  );
  if (defaultWorkingDirectory.error) {
    issues.push(defaultWorkingDirectory.error);
  }

  const shellCommand = normalizeOptionalString(configuration.get<string>(SHELL_COMMAND_CONFIGURATION_KEY, ""));
  const shellExtraArgs = configuration.get<string>(SHELL_EXTRA_ARGS_CONFIGURATION_KEY, "") ?? "";
  const shellValidation = shellCommand
    ? validateConfiguredCommand(shellCommand)
    : null;
  if (shellValidation?.status !== "ready") {
    if (shellCommand) {
      issues.push({
        message: shellValidation?.statusLabel ?? "Shell command is not ready.",
        profileId: null,
        settingPath: "workTerminal.shellCommand",
      });
    }
  }

  const shellArgsValidation = validateShellExtraArgs(shellExtraArgs);
  if (shellArgsValidation.error) {
    issues.push(shellArgsValidation.error);
  }

  if (!shellCommand && shellExtraArgs.trim()) {
    issues.push({
      message: "Shell extra args are ignored until workTerminal.shellCommand is set.",
      profileId: null,
      settingPath: "workTerminal.shellExtraArgs",
    });
  }

  return {
    defaultWorkingDirectory: defaultWorkingDirectory.path,
    defaultWorkingDirectoryLabel: defaultWorkingDirectory.label,
    issues,
    shellArgs: shellCommand ? [...(shellValidation?.tokens.slice(1) ?? []), ...shellArgsValidation.tokens] : [],
    shellCommand,
    shellExecutable: shellValidation?.executable ?? undefined,
    shellStatusLabel: shellCommand
      ? (shellValidation?.statusLabel ?? "Shell command is not ready.")
      : "VS Code integrated shell default",
  };
}

export function resolveAgentProfileWorkingDirectory(
  profile: AgentProfile,
  workspaceRootPath: string | null,
  defaultWorkingDirectory: string | undefined,
): ResolvedWorkingDirectory {
  if (!profile.workingDirectory) {
    return {
      error: null,
      label: defaultWorkingDirectory ? `Default - ${defaultWorkingDirectory}` : "Workspace default",
      path: defaultWorkingDirectory,
    };
  }

  return resolveConfiguredWorkingDirectory(
    profile.workingDirectory,
    workspaceRootPath,
    `workTerminal.agentProfiles.${profile.id}.workingDirectory`,
  );
}

export function resolveConfiguredWorkingDirectory(
  configuredValue: string | undefined,
  workspaceRootPath: string | null,
  settingPath: string,
): ResolvedWorkingDirectory {
  const normalized = normalizeOptionalString(configuredValue);
  if (!normalized) {
    return {
      error: null,
      label: workspaceRootPath ? `Workspace default - ${workspaceRootPath}` : "No workspace default",
      path: workspaceRootPath ?? undefined,
    };
  }

  if (!workspaceRootPath && !isAbsolute(normalized)) {
    return {
      error: {
        message: "Relative working directories require an open workspace.",
        profileId: null,
        settingPath,
      },
      label: `Invalid - ${normalized}`,
      path: undefined,
    };
  }

  const resolvedPath = isAbsolute(normalized)
    ? normalized
    : resolve(workspaceRootPath!, normalized);

  try {
    const stats = statSync(resolvedPath);
    if (!stats.isDirectory()) {
      return {
        error: {
          message: `Working directory must point to a directory. Resolved to ${resolvedPath}.`,
          profileId: null,
          settingPath,
        },
        label: `Invalid - ${resolvedPath}`,
        path: undefined,
      };
    }
  } catch {
    return {
      error: {
        message: `Working directory does not exist. Resolved to ${resolvedPath}.`,
        profileId: null,
        settingPath,
      },
      label: `Missing - ${resolvedPath}`,
      path: undefined,
    };
  }

  return {
    error: null,
    label: `Resolved - ${resolvedPath}`,
    path: resolvedPath,
  };
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function validateShellExtraArgs(extraArgs: string): {
  readonly error: ConfigurationIssue | null;
  readonly tokens: readonly string[];
} {
  const normalized = extraArgs.trim();
  if (!normalized) {
    return { error: null, tokens: [] };
  }

  if (hasUnmatchedQuote(normalized)) {
    return {
      error: {
        message: "Shell extra args contain an unmatched quote.",
        profileId: null,
        settingPath: "workTerminal.shellExtraArgs",
      },
      tokens: [],
    };
  }

  return {
    error: null,
    tokens: splitShellTokens(normalized),
  };
}

function hasUnmatchedQuote(value: string): boolean {
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      if (quote === null) {
        quote = character;
      } else if (quote === character) {
        quote = null;
      }
    }
  }

  return quote !== null;
}

function splitShellTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      const next = value[index + 1];
      if (next !== undefined) {
        current += next;
        index += 1;
        continue;
      }
    }

    if (character === '"' || character === "'") {
      if (quote === null) {
        quote = character;
        continue;
      }
      if (quote === character) {
        quote = null;
        continue;
      }
    }

    if (quote === null && /\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
