import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve, win32 } from "node:path";

import { getResumeBehaviorLabel, type AgentProfile, type AgentProfileSummary } from "./AgentProfile";

const DEFAULT_WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";

export interface AgentLaunchPlan {
  readonly args: readonly string[];
  readonly executable: string;
  readonly initialPrompt: string | null;
  readonly sessionId: string | null;
}

export interface ValidatedConfiguredCommand {
  readonly executable: string | null;
  readonly normalizedCommand: string;
  readonly resolved: string;
  readonly status: "invalid-configuration" | "missing-command" | "ready";
  readonly statusLabel: string;
  readonly tokens: readonly string[];
}

export function buildAgentLaunchPlan(options: {
  readonly contextPrompt: string | null;
  readonly profile: AgentProfile;
  readonly resumeSessionId?: string | null;
}): AgentLaunchPlan {
  const commandValidation = validateConfiguredCommand(options.profile.command);

  if (commandValidation.status !== "ready" || !commandValidation.executable) {
    throw new Error(`${options.profile.label} is not ready. ${commandValidation.statusLabel}`);
  }

  const extraArgsValidation = validateConfiguredCommandArgumentString(options.profile.extraArgs);
  if (extraArgsValidation.error) {
    throw new Error(`Extra arguments for ${options.profile.label} are invalid. ${extraArgsValidation.error}`);
  }

  const baseArgs = commandValidation.tokens.slice(1);
  const sessionId = options.profile.kind === "claude" ? options.resumeSessionId ?? crypto.randomUUID() : null;
  const agentArgs = options.profile.kind === "claude" && sessionId ? ["--session-id", sessionId] : [];

  return {
    args: [...baseArgs, ...extraArgsValidation.tokens, ...agentArgs],
    executable: commandValidation.executable,
    initialPrompt: options.profile.usesContext ? options.contextPrompt : null,
    sessionId,
  };
}

export function getAgentProfileSummaries(
  profiles: readonly AgentProfile[],
  options: {
    readonly getWorkingDirectoryLabel?: (profile: AgentProfile) => string;
    readonly getWorkingDirectoryStatus?: (profile: AgentProfile) => {
      readonly status: "invalid-configuration" | "ready";
      readonly statusLabel: string;
    };
  } = {},
): readonly AgentProfileSummary[] {
  return profiles.map((profile) => {
    const commandValidation = validateConfiguredCommand(profile.command);
    const workingDirectoryStatus = options.getWorkingDirectoryStatus?.(profile) ?? {
      status: "ready" as const,
      statusLabel: "",
    };
    const workingDirectoryLabel = options.getWorkingDirectoryLabel?.(profile) ?? "Workspace default";
    const status = commandValidation.status === "ready" && workingDirectoryStatus.status !== "ready"
      ? "invalid-configuration"
      : commandValidation.status;
    const statusLabel = commandValidation.status === "ready" && workingDirectoryStatus.status !== "ready"
      ? `Invalid configuration - ${workingDirectoryStatus.statusLabel}`
      : commandValidation.statusLabel;

    return {
      ...profile,
      resumeBehaviorLabel: getResumeBehaviorLabel(profile),
      status,
      statusLabel,
      workingDirectoryLabel,
    };
  });
}

export function validateConfiguredCommand(command: string): ValidatedConfiguredCommand {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return {
      executable: null,
      normalizedCommand,
      resolved: normalizedCommand,
      status: "invalid-configuration",
      statusLabel: "Invalid configuration - add a launch command.",
      tokens: [],
    };
  }

  const parsed = parseConfiguredCommand(command);
  if (parsed.error) {
    return {
      executable: null,
      normalizedCommand,
      resolved: normalizedCommand,
      status: "invalid-configuration",
      statusLabel: `Invalid configuration - ${parsed.error}`,
      tokens: parsed.tokens,
    };
  }

  const executable = parsed.tokens[0] ?? null;
  if (!executable) {
    return {
      executable: null,
      normalizedCommand,
      resolved: normalizedCommand,
      status: "invalid-configuration",
      statusLabel: "Invalid configuration - add a launch command.",
      tokens: parsed.tokens,
    };
  }

  const resolvedCommand = resolveCommandInfo(executable);
  return {
    executable,
    normalizedCommand,
    resolved: resolvedCommand.resolved,
    status: resolvedCommand.found ? "ready" : "missing-command",
    statusLabel: resolvedCommand.found
      ? `Ready - ${resolvedCommand.resolved}`
      : `Missing from PATH - ${normalizedCommand}`,
    tokens: parsed.tokens,
  };
}

export function splitConfiguredCommand(command: string): string[] {
  return [...parseConfiguredCommand(command).tokens];
}

function parseConfiguredCommand(command: string): {
  readonly error: string | null;
  readonly tokens: readonly string[];
} {
  const normalized = command.trim();
  if (!normalized) {
    return { error: null, tokens: [] };
  }

  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (quote === null && /\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      if (quote === null) {
        quote = character;
        tokenStarted = true;
        continue;
      }
      if (quote === character) {
        quote = null;
        continue;
      }
    }

    if (character === "\\") {
      const next = normalized[index + 1];
      if (next !== undefined) {
        if (quote === '"' && next === '"') {
          current += next;
          tokenStarted = true;
          index += 1;
          continue;
        }
        if (quote === null && (/\s/.test(next) || next === '"' || next === "'")) {
          current += next;
          tokenStarted = true;
          index += 1;
          continue;
        }
      }
    }

    current += character;
    tokenStarted = true;
  }

  if (tokenStarted) {
    tokens.push(current);
  }

  return {
    error: quote === null ? null : `command has an unmatched ${quote === '"' ? "double" : "single"} quote.`,
    tokens,
  };
}

function validateConfiguredCommandArgumentString(commandArguments: string): {
  readonly error: string | null;
  readonly tokens: readonly string[];
} {
  if (!commandArguments.trim()) {
    return { error: null, tokens: [] };
  }

  const parsed = parseConfiguredCommand(commandArguments);
  return {
    error: parsed.error,
    tokens: parsed.tokens,
  };
}

function resolveCommandInfo(command: string): { readonly found: boolean; readonly resolved: string } {
  const requested = command.trim();
  if (!requested) {
    return { found: false, resolved: requested };
  }

  if (isAbsolute(requested)) {
    return { found: isExecutable(requested), resolved: requested };
  }

  const pathLike = requested.includes("/") || /^[A-Za-z]:[\\/]/.test(requested) || requested.includes("\\");
  if (pathLike) {
    const resolvedPath = resolve(requested);
    return { found: isExecutable(resolvedPath), resolved: resolvedPath };
  }

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, requested);
    const resolvedPath = findExecutable(candidate);
    if (resolvedPath) {
      return { found: true, resolved: resolvedPath };
    }
  }

  return { found: false, resolved: requested };
}

function findExecutable(candidate: string): string | null {
  const candidates = process.platform === "win32"
    ? [candidate, ...getWindowsExecutableExtensions().map((extension) => `${candidate}${extension}`)]
    : [candidate];

  for (const pathToCheck of candidates) {
    if (isExecutable(pathToCheck)) {
      return pathToCheck;
    }
  }

  return null;
}

function getWindowsExecutableExtensions(): string[] {
  return (process.env.PATHEXT ?? DEFAULT_WINDOWS_PATHEXT)
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isExecutable(pathToCheck: string): boolean {
  try {
    const stats = statSync(pathToCheck);
    if (stats.isDirectory()) {
      return false;
    }

    if (process.platform === "win32") {
      return getWindowsExecutableExtensions().includes(win32.extname(pathToCheck).toLowerCase());
    }

    accessSync(pathToCheck, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
