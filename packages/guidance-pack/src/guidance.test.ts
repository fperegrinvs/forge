import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exists } from "@forge/shared-utils";
import {
  discoverSkills,
  getBundledGuidanceRoot,
  installGuidance,
  loadBundledWorkflowPolicy,
  resolveAgentsPrecedence
} from "./guidance.js";

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
