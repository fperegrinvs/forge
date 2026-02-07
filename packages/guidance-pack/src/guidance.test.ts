import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exists } from "@forge/shared-utils";
import {
  discoverSkills,
  getBundledGuidanceRoot,
  installGuidance,
  loadBundledManifest,
  loadBundledWorkflowPolicy,
  resolveAgentsPrecedence
} from "./guidance.js";
import "./index.js";

describe("guidance pack", () => {
  it("resolves precedence order", () => {
    expect(resolveAgentsPrecedence()).toEqual([
      "global",
      "repo_root",
      "nearest_directory_override"
    ]);
  });

  it("discovers skills and required SKILL.md", async () => {
    const skills = await discoverSkills(getBundledGuidanceRoot());
    expect(skills.length).toBeGreaterThan(0);
    expect(skills[0]?.hasSkillFile).toBe(true);
  });

  it("installs guidance files", async () => {
    const target = await mkdtemp(join(tmpdir(), "forge-guidance-test-"));
    const result = await installGuidance(target);
    expect(result.installed.length).toBeGreaterThan(0);
    expect(await exists(join(target, "manifest.json"))).toBe(true);
  });

  it("skips identical files on re-install", async () => {
    const target = await mkdtemp(join(tmpdir(), "forge-guidance-test-"));
    await installGuidance(target);

    const second = await installGuidance(target);
    expect(second.installed.length).toBe(0);
    expect(second.updated.length).toBe(0);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it("updates changed files only when forceReplace is enabled", async () => {
    const target = await mkdtemp(join(tmpdir(), "forge-guidance-test-"));
    await installGuidance(target);

    const manifestPath = join(target, "manifest.json");
    const original = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, `${original}\n# local edit\n`, "utf8");

    const withoutForce = await installGuidance(target);
    expect(withoutForce.updated.length).toBe(0);
    expect(withoutForce.skipped).toContain("manifest.json");

    const withForce = await installGuidance(target, { forceReplace: true });
    expect(withForce.updated).toContain("manifest.json");
  });

  it("loads bundled manifest", async () => {
    const manifest = await loadBundledManifest();
    expect(manifest).toBeTruthy();
  });

  it("loads bundled workflow policy", async () => {
    const policy = await loadBundledWorkflowPolicy();
    expect(policy.version).toBeDefined();
  });

  it("keeps generated skills aligned with policy skill list", async () => {
    const root = getBundledGuidanceRoot();
    const policy = await loadBundledWorkflowPolicy();
    const policySkills =
      Array.isArray((policy as Record<string, unknown>).skills)
        ? ((policy as Record<string, unknown>).skills as Array<Record<string, unknown>>)
            .map((skill) => skill.name)
            .filter((name): name is string => typeof name === "string")
        : [];

    const generatedSkills = await readdir(join(root, "skills"), { withFileTypes: true });
    const generatedSkillNames = generatedSkills.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

    expect([...generatedSkillNames].sort()).toEqual([...policySkills].sort());

    for (const name of generatedSkillNames) {
      const skillFile = await readFile(join(root, "skills", name, "SKILL.md"), "utf8");
      expect(skillFile.trim().length).toBeGreaterThan(0);
    }
  });
});
