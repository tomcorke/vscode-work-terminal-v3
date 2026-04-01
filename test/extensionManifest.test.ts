import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type PackageManifest = {
  contributes?: {
    viewsContainers?: {
      activitybar?: Array<{
        id?: string;
        icon?: string;
      }>;
    };
  };
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as PackageManifest;
}

function readVsCodeIgnoreLines(): string[] {
  return readFileSync(path.join(repoRoot, ".vscodeignore"), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

describe("extension manifest", () => {
  it("declares an activity bar icon asset for the work terminal container", () => {
    const manifest = readManifest();
    const activityBarContainer = manifest.contributes?.viewsContainers?.activitybar?.find(
      (container) => container.id === "workTerminal",
    );

    expect(activityBarContainer).toBeDefined();

    const iconPath = activityBarContainer?.icon;
    expect(iconPath).toBe("media/work-terminal-activity-bar.svg");
    expect(iconPath).toBeTruthy();
    expect(existsSync(path.join(repoRoot, iconPath!))).toBe(true);
  });

  it("does not exclude the media directory from VSIX packaging", () => {
    const ignoreLines = readVsCodeIgnoreLines();
    const excludesMedia = ignoreLines.some((line) =>
      /^!/.test(line)
        ? false
        : /^(?:\*\*\/)?media(?:\/?$|\/\*\*$)/u.test(line),
    );

    expect(excludesMedia).toBe(false);
  });
});
