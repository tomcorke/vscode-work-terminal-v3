import { describe, expect, it } from "vitest";

import {
  loadTerminalLaunchConfiguration,
  resolveAgentProfileWorkingDirectory,
} from "../../src/terminals/TerminalLaunchConfiguration";

describe("TerminalLaunchConfiguration", () => {
  it("reports a missing default working directory with a setting path", () => {
    const summary = loadTerminalLaunchConfiguration({
      get<T>(section: string, defaultValue?: T): T {
        if (section === "defaultWorkingDirectory") {
          return "./missing-dir" as T;
        }

        return defaultValue as T;
      },
    }, "/workspace");

    expect(summary.issues).toEqual([
      expect.objectContaining({
        settingPath: "workTerminal.defaultWorkingDirectory",
      }),
    ]);
  });

  it("reports shell extra args without a shell command", () => {
    const summary = loadTerminalLaunchConfiguration({
      get<T>(section: string, defaultValue?: T): T {
        if (section === "shellExtraArgs") {
          return "--login" as T;
        }

        return defaultValue as T;
      },
    }, "/workspace");

    expect(summary.issues).toEqual([
      expect.objectContaining({
        settingPath: "workTerminal.shellExtraArgs",
      }),
    ]);
  });

  it("resolves profile working directories relative to the workspace", () => {
    const resolved = resolveAgentProfileWorkingDirectory({
      builtIn: false,
      command: "custom",
      extraArgs: "",
      id: "custom-agent",
      kind: "custom",
      label: "Custom agent",
      usesContext: false,
      workingDirectory: ".",
    }, "/tmp", undefined);

    expect(resolved.path).toBe("/tmp");
    expect(resolved.error).toBeNull();
  });
});
