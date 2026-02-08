import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function getRepoRootFromThisFile(): string {
  // This file lives at: <repo>/apps/desktop/src/*.ts
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..");
}

describe("desktop: tauri no-reload dev entrypoint", () => {
  it("exposes a bun script alias for the no-reload workflow", () => {
    // Given the repo root package.json
    const repoRoot = getRepoRootFromThisFile();
    const packageJsonPath = join(repoRoot, "package.json");

    // When reading scripts.dev:desktop:tauri:noreload
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
    const command = pkg.scripts?.["dev:desktop:tauri:noreload"];

    // Then it points at the wrapper script
    expect(command).toBe("./scripts/dev-desktop-tauri-noreload.sh");
  });

  it("provides a wrapper script that disables both frontend and tauri watchers", () => {
    // Given the expected wrapper script path
    const repoRoot = getRepoRootFromThisFile();
    const scriptPath = join(repoRoot, "scripts/dev-desktop-tauri-noreload.sh");

    // When checking the script exists
    const exists = existsSync(scriptPath);

    // Then it should exist
    expect(exists).toBe(true);
    if (!exists) {
      return;
    }

    // When reading its contents
    const body = readFileSync(scriptPath, "utf8");

    // Then it should invoke the existing dev script with flags to avoid reloads
    expect(body).toContain("dev-desktop-tauri.sh");
    expect(body).toContain("--oneshot");
    expect(body).toContain("--no-watch");
  });
});

