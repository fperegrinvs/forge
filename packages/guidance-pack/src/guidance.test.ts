import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { exists } from "@forge/shared-utils";
import {
  discoverSkills,
  getBundledGuidanceRoot,
  installGuidance,
  installGuidanceFromPackRoot,
  registerCodexSkills,
  loadBundledManifest,
  loadBundledWorkflowPolicy,
  registerSkillCommands,
  resolveAgentsPrecedence,
  stripFrontmatter
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

  it("installs guidance from an explicit pack root", async () => {
    // Given a minimal guidance pack on disk
    const packRoot = await mkdtemp(join(tmpdir(), "forge-guidance-packroot-"));
    await writeFile(
      join(packRoot, "manifest.json"),
      JSON.stringify({ name: "forge-guidance-pack", version: "9.9.9" }, null, 2),
      "utf8"
    );
    await mkdir(join(packRoot, "rules"), { recursive: true });
    await writeFile(join(packRoot, "rules", "example.md"), "from-pack\n", "utf8");

    // And a target directory
    const target = await mkdtemp(join(tmpdir(), "forge-guidance-target-"));

    // When guidance is installed from the explicit pack root
    const result = await installGuidanceFromPackRoot(packRoot, target);

    // Then files are installed into the target root
    expect(result.installed).toContain("manifest.json");
    expect(result.installed).toContain("rules/example.md");
    expect(await exists(join(target, "rules", "example.md"))).toBe(true);
  });

  it("preserves non-UTF8 file contents when force replacing", async () => {
    // Given a minimal guidance pack on disk with a binary file
    const packRoot = await mkdtemp(join(tmpdir(), "forge-guidance-packroot-binary-"));
    await writeFile(
      join(packRoot, "manifest.json"),
      JSON.stringify({ name: "forge-guidance-pack", version: "9.9.9" }, null, 2),
      "utf8"
    );
    await mkdir(join(packRoot, "assets"), { recursive: true });
    const bytes = Buffer.from([0xff, 0x00, 0x61, 0x62, 0x63]);
    await writeFile(join(packRoot, "assets", "blob.bin"), bytes);

    // And a target directory with an existing (different) file at the same path
    const target = await mkdtemp(join(tmpdir(), "forge-guidance-target-binary-"));
    await mkdir(join(target, "assets"), { recursive: true });
    await writeFile(join(target, "assets", "blob.bin"), Buffer.from([0x00, 0x00, 0x00]));

    // When guidance is installed with force replace
    const result = await installGuidanceFromPackRoot(packRoot, target, { forceReplace: true });

    // Then the file is updated byte-for-byte
    expect(result.updated).toContain("assets/blob.bin");
    const written = await readFile(join(target, "assets", "blob.bin"));
    expect(Buffer.from(written)).toEqual(bytes);
  });

  it("loads bundled manifest", async () => {
    const manifest = await loadBundledManifest();
    expect(manifest).toBeTruthy();
  });

  it("loads bundled workflow policy", async () => {
    const policy = await loadBundledWorkflowPolicy();
    expect(policy.version).toBeDefined();
  });

  it("discovers plan-guided skill with references", async () => {
    // Given the bundled guidance root
    const root = getBundledGuidanceRoot();
    // When skills are discovered
    const skills = await discoverSkills(root);
    // Then plan-guided is present with a SKILL.md and references
    const planGuided = skills.find((s) => s.name === "plan-guided");
    expect(planGuided).toBeDefined();
    expect(planGuided!.hasSkillFile).toBe(true);
    expect(planGuided!.hasReferences).toBe(true);
  });

  it("stripFrontmatter removes leading YAML frontmatter block", () => {
    // Given markdown content with YAML frontmatter
    const content = "---\nname: test\ndescription: a test skill\n---\n\n# Heading\n\nBody text.\n";
    // When frontmatter is stripped
    const result = stripFrontmatter(content);
    // Then only the markdown body remains
    expect(result).toBe("# Heading\n\nBody text.\n");
  });

  it("stripFrontmatter returns content unchanged when no frontmatter exists", () => {
    // Given markdown content without frontmatter
    const content = "# Just a heading\n\nSome text.\n";
    // When stripFrontmatter is called
    const result = stripFrontmatter(content);
    // Then the content is returned as-is
    expect(result).toBe(content);
  });

  it("registerSkillCommands creates .claude/commands/<name>.md with frontmatter stripped", async () => {
    // Given a skills directory with a skill containing YAML frontmatter
    const skillsDir = await mkdtemp(join(tmpdir(), "forge-skills-"));
    const skillDir = join(skillsDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: Test skill\n---\n\n# my-skill\n\nInstructions here.\n",
      "utf8"
    );

    const targetRoot = await mkdtemp(join(tmpdir(), "forge-target-"));

    // When skill commands are registered
    const result = await registerSkillCommands(skillsDir, targetRoot);

    // Then .claude/commands/my-skill.md exists with frontmatter stripped
    expect(result.claude).toContain("my-skill");
    const claudeCmd = await readFile(join(targetRoot, ".claude", "commands", "my-skill.md"), "utf8");
    expect(claudeCmd).not.toContain("---");
    expect(claudeCmd).toContain("# my-skill");
    expect(claudeCmd).toContain("Instructions here.");
  });

  it("registerSkillCommands creates .agents/skills/<name>/SKILL.md preserving content", async () => {
    // Given a skills directory with a skill
    const skillsDir = await mkdtemp(join(tmpdir(), "forge-skills-"));
    const skillDir = join(skillsDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    const originalContent = "---\nname: my-skill\n---\n\n# my-skill\n\nFull content.\n";
    await writeFile(join(skillDir, "SKILL.md"), originalContent, "utf8");

    const targetRoot = await mkdtemp(join(tmpdir(), "forge-target-"));

    // When skill commands are registered
    const result = await registerSkillCommands(skillsDir, targetRoot);

    // Then .agents/skills/my-skill/SKILL.md exists with full content preserved
    expect(result.codex).toContain("my-skill");
    const codexSkill = await readFile(join(targetRoot, ".agents", "skills", "my-skill", "SKILL.md"), "utf8");
    expect(codexSkill).toBe(originalContent);
  });

  it("registerCodexSkills writes only .agents/skills and does not create .claude/commands", async () => {
    const skillsDir = await mkdtemp(join(tmpdir(), "forge-skills-codex-only-"));
    const skillDir = join(skillsDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    const originalContent = "---\nname: my-skill\n---\n\n# my-skill\n\nFull content.\n";
    await writeFile(join(skillDir, "SKILL.md"), originalContent, "utf8");

    const targetRoot = await mkdtemp(join(tmpdir(), "forge-target-codex-only-"));

    const result = await registerCodexSkills(skillsDir, targetRoot);
    expect(result.updated).toContain("my-skill");

    const codexSkill = await readFile(join(targetRoot, ".agents", "skills", "my-skill", "SKILL.md"), "utf8");
    expect(codexSkill).toBe(originalContent);

    expect(await exists(join(targetRoot, ".claude", "commands", "my-skill.md"))).toBe(false);
  });

  it("installGuidance populates both .claude/commands/ and .agents/skills/", async () => {
    // Given the bundled guidance pack
    const target = await mkdtemp(join(tmpdir(), "forge-guidance-commands-"));

    // When guidance is installed
    await installGuidance(target);

    // Then Claude Code commands are created for discovered skills
    expect(await exists(join(target, ".claude", "commands", "plan-guided.md"))).toBe(true);
    const claudeCmd = await readFile(join(target, ".claude", "commands", "plan-guided.md"), "utf8");
    expect(claudeCmd).not.toMatch(/^---/);
    expect(claudeCmd).toContain("# plan-guided");

    // And Codex skills are created
    expect(await exists(join(target, ".agents", "skills", "plan-guided", "SKILL.md"))).toBe(true);
  });

  it("registerSkillCommands skips identical command files on re-register", async () => {
    // Given a skills directory with a skill
    const skillsDir = await mkdtemp(join(tmpdir(), "forge-skills-"));
    const skillDir = join(skillsDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\n---\n\n# my-skill\n\nContent.\n",
      "utf8"
    );
    const targetRoot = await mkdtemp(join(tmpdir(), "forge-target-"));

    // When skill commands are registered twice
    const first = await registerSkillCommands(skillsDir, targetRoot);
    const second = await registerSkillCommands(skillsDir, targetRoot);

    // Then first call registers, second call returns empty (idempotent)
    expect(first.claude).toContain("my-skill");
    expect(second.claude).toEqual([]);
    expect(second.codex).toEqual([]);
  });

  it("plan-constraints.md contains embedded schema matching contracts source of truth", async () => {
    // Given the authoritative schema from contracts
    const schemaPath = join(__dirname, "..", "..", "contracts", "src", "schema", "plan.v1.schema.json");
    const schemaJson = JSON.parse(await readFile(schemaPath, "utf8"));

    // And the plan-constraints.md reference doc
    const constraintsPath = join(
      getBundledGuidanceRoot(),
      "skills",
      "plan-guided",
      "references",
      "plan-constraints.md"
    );
    const constraintsMd = await readFile(constraintsPath, "utf8");

    // When we extract the JSON code block containing "$schema"
    const jsonBlocks = constraintsMd.match(/```json\n([\s\S]*?)```/g) ?? [];
    const schemaBlock = jsonBlocks.find((block) => block.includes('"$schema"'));
    expect(schemaBlock).toBeDefined();
    const embedded = JSON.parse(schemaBlock!.replace(/```json\n/, "").replace(/```$/, ""));

    // Then it matches the contracts source of truth
    expect(embedded).toEqual(schemaJson);
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
