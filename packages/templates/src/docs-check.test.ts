import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "./template.js";

function runDocsCheck(cwd: string): string {
  return execFileSync("node", ["scripts/docs-check.mjs"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

describe("template docs check", () => {
  it("passes for initialized project docs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-doc-check-pass-"));
    const project = await initProject("demo", dir);

    const output = runDocsCheck(project);
    expect(output).toContain("Docs check passed");
  });

  it("fails when decisions.md lacks a dated heading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-doc-check-fail-"));
    const project = await initProject("demo", dir);
    await writeFile(join(project, "decisions.md"), "# Decisions\n\nNo date heading.\n", "utf8");

    expect(() => runDocsCheck(project)).toThrow();
  });
});
