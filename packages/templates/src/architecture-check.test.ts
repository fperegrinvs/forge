import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "./template.js";

function runArchitectureCheck(cwd: string): string {
  return execFileSync("node", ["scripts/architecture-check.mjs"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

describe("template architecture check", () => {
  it("passes for initialized project modules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-arch-check-pass-"));
    const project = await initProject("demo", dir);

    const output = runArchitectureCheck(project);
    expect(output).toContain("Architecture check passed");
  });

  it("fails when required module files are missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-arch-check-fail-"));
    const project = await initProject("demo", dir);
    await rm(join(project, "modules", "starter", "container.ts"));

    expect(() => runArchitectureCheck(project)).toThrow();
  });
});
