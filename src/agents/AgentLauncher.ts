import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve, win32 } from "node:path";

import {
  getBuiltInAgentProfiles,
  type AgentProfile,
  type AgentProfileSummary,
} from "./AgentProfile";

const DEFAULT_WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";

export interface AgentLaunchPlan {
  readonly args: readonly string[];
  readonly executable: string;
  readonly initialPrompt: string | null;
  readonly sessionId: string | null;
}

export function buildAgentLaunchPlan(options: {
  readonly configuredCommand: string;
  readonly configuredExtraArgs: string;
  readonly contextPrompt: string | null;
  readonly profile: AgentProfile;
}): AgentLaunchPlan {
  const commandTokens = splitConfiguredCommand(options.configuredCommand.trim());

  if (commandTokens.length === 0) {
    throw new Error(`No command configured for ${options.profile.label}.`);
  }

  const executable = commandTokens[0];
  const baseArgs = commandTokens.slice(1);
  const extraArgs = splitConfiguredCommand(options.configuredExtraArgs.trim());
  const sessionId = options.profile.kind === "claude" ? crypto.randomUUID() : null;
  const agentArgs = options.profile.kind === "claude" && sessionId ? ["--session-id", sessionId] : [];

  return {
    args: [...baseArgs, ...extraArgs, ...agentArgs],
    executable,
    initialPrompt: options.profile.usesContext ? options.contextPrompt : null,
    sessionId,
  };
}

export function getAgentProfileSummaries(configuration: {
  get<T>(section: string, defaultValue?: T): T;
}): readonly AgentProfileSummary[] {
  return getBuiltInAgentProfiles().map((profile) => {
    const command = getNormalizedConfiguredCommand(
      configuration.get<string>(profile.commandConfigurationKey, profile.defaultCommand),
      profile.defaultCommand,
    );
    const resolvedCommand = resolveConfiguredCommand(command);

    return {
      command,
      id: profile.id,
      kind: profile.kind,
      label: profile.label,
      resumeBehaviorLabel: profile.resumeBehaviorLabel,
      status: resolvedCommand.found ? "ready" : "missing-command",
      statusLabel: resolvedCommand.found
        ? `Ready - ${resolvedCommand.resolved}`
        : `Missing from PATH - ${command || profile.defaultCommand}`,
      usesContext: profile.usesContext,
    };
  });
}

export function splitConfiguredCommand(command: string): string[] {
  const normalized = command.trim();
  if (!normalized) {
    return [];
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

  return tokens;
}

export function getNormalizedConfiguredCommand(
  configuredCommand: string | undefined,
  defaultCommand: string,
): string {
  const trimmed = configuredCommand?.trim() ?? "";
  return trimmed || defaultCommand;
}

function resolveConfiguredCommand(command: string): { readonly found: boolean; readonly resolved: string } {
  const requested = splitConfiguredCommand(command.trim())[0]?.trim() ?? "";
  if (!requested) {
    return { found: false, resolved: requested };
  }

  return resolveCommandInfo(requested);
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
