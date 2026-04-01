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

describe("extension manifest", () => {
  it("declares an activity bar icon asset for the work terminal container", () => {
    const manifest = readManifest();
    const activityBarContainer = manifest.contributes?.viewsContainers?.activitybar?.find(
      (container) => container.id === "workTerminal",
    );

    expect(activityBarContainer?.icon).toBe("media/work-terminal-activity-bar.svg");
    expect(existsSync(path.join(repoRoot, activityBarContainer?.icon ?? ""))).toBe(true);
  });
});
