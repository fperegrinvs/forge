import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { exists, listFilesRecursive } from "@forge/shared-utils";
import type { InstallGuidanceOptions, InstallGuidanceResult, RegisteredCommands, SkillDescriptor } from "./types.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const builtPackRoot = join(currentDir, "assets", "pack");
const sourcePackRoot = join(currentDir, "..", "src", "assets", "pack");
const bundledPackRoot = existsSync(builtPackRoot) ? builtPackRoot : sourcePackRoot;
const policyFile = "workflow-policy.v1.json";

function hashBytes(value: Uint8Array): string {
  return createHash("sha1").update(value).digest("hex");
}

export function resolveAgentsPrecedence(): string[] {
  return ["global", "repo_root", "nearest_directory_override"];
}

export async function discoverSkills(guidanceRoot: string): Promise<SkillDescriptor[]> {
  const skillsDir = join(guidanceRoot, "skills");
  if (!(await exists(skillsDir))) {
    return [];
  }

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: SkillDescriptor[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = join(skillsDir, entry.name);
    skills.push({
      name: entry.name,
      hasSkillFile: await exists(join(skillPath, "SKILL.md")),
      hasScripts: await exists(join(skillPath, "scripts")),
      hasReferences: await exists(join(skillPath, "references")),
      hasAssets: await exists(join(skillPath, "assets"))
    });
  }

  return skills;
}

export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return content;
  }
  // Skip past the closing "---" line and any leading blank lines
  const afterFrontmatter = content.slice(endIndex + 4);
  return afterFrontmatter.replace(/^\n+/, "");
}

export async function registerSkillCommands(
  skillsDir: string,
  targetRoot: string
): Promise<RegisteredCommands> {
  const result: RegisteredCommands = { claude: [], codex: [] };

  if (!(await exists(skillsDir))) {
    return result;
  }

  const entries = await readdir(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillMdPath = join(skillsDir, entry.name, "SKILL.md");
    if (!(await exists(skillMdPath))) {
      continue;
    }

    const content = await readFile(skillMdPath, "utf8");
    const contentBytes = Buffer.from(content, "utf8");
    const strippedContent = stripFrontmatter(content);
    const strippedBytes = Buffer.from(strippedContent, "utf8");

    // Claude Code: .claude/commands/<name>.md (frontmatter stripped)
    const claudeDir = join(targetRoot, ".claude", "commands");
    const claudePath = join(claudeDir, `${entry.name}.md`);
    await mkdir(claudeDir, { recursive: true });

    let claudeChanged = true;
    if (await exists(claudePath)) {
      const existing = await readFile(claudePath);
      if (hashBytes(existing) === hashBytes(strippedBytes)) {
        claudeChanged = false;
      }
    }
    if (claudeChanged) {
      await writeFile(claudePath, strippedContent, "utf8");
      result.claude.push(entry.name);
    }

    // Codex: .agents/skills/<name>/SKILL.md (full content preserved)
    const codexDir = join(targetRoot, ".agents", "skills", entry.name);
    const codexPath = join(codexDir, "SKILL.md");
    await mkdir(codexDir, { recursive: true });

    let codexChanged = true;
    if (await exists(codexPath)) {
      const existing = await readFile(codexPath);
      if (hashBytes(existing) === hashBytes(contentBytes)) {
        codexChanged = false;
      }
    }
    if (codexChanged) {
      await writeFile(codexPath, content, "utf8");
      result.codex.push(entry.name);
    }
  }

  return result;
}

export async function installGuidanceFromPackRoot(
  packRoot: string,
  targetRoot: string,
  options: InstallGuidanceOptions = {}
): Promise<InstallGuidanceResult> {
  const sourceFiles = await listFilesRecursive(packRoot);
  const result: InstallGuidanceResult = {
    installed: [],
    updated: [],
    skipped: []
  };

  for (const source of sourceFiles) {
    const rel = relative(packRoot, source);
    const destination = join(targetRoot, rel);
    const destinationDir = dirname(destination);

    await mkdir(destinationDir, { recursive: true });

    // Guidance packs are primarily text, but treat files as bytes so we don't corrupt
    // non-UTF8 content (images, binaries) if they appear later.
    const sourceContent = await readFile(source);

    if (!(await exists(destination))) {
      await cp(source, destination);
      result.installed.push(rel);
      continue;
    }

    const existingContent = await readFile(destination);
    if (hashBytes(existingContent) === hashBytes(sourceContent)) {
      result.skipped.push(rel);
      continue;
    }

    if (options.forceReplace) {
      await cp(source, destination, { force: true });
      result.updated.push(rel);
    } else {
      result.skipped.push(rel);
    }
  }

  // Register skills as agent-native commands
  const skillsDir = join(packRoot, "skills");
  const registered = await registerSkillCommands(skillsDir, targetRoot);
  for (const name of registered.claude) {
    result.installed.push(join(".claude", "commands", `${name}.md`));
  }
  for (const name of registered.codex) {
    result.installed.push(join(".agents", "skills", name, "SKILL.md"));
  }

  return result;
}

export function getBundledGuidanceRoot(): string {
  return bundledPackRoot;
}

export async function installGuidance(
  targetRoot: string,
  options: InstallGuidanceOptions = {}
): Promise<InstallGuidanceResult> {
  return await installGuidanceFromPackRoot(bundledPackRoot, targetRoot, options);
}

export async function loadBundledManifest(): Promise<Record<string, unknown>> {
  const manifestPath = join(bundledPackRoot, "manifest.json");
  const content = await readFile(manifestPath, "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

export async function loadBundledWorkflowPolicy(): Promise<Record<string, unknown>> {
  const builtPath = join(currentDir, "policy", policyFile);
  const sourcePath = join(currentDir, "..", "src", "policy", policyFile);
  const content = await readFile(builtPath, "utf8").catch(() => readFile(sourcePath, "utf8"));
  return JSON.parse(content) as Record<string, unknown>;
}

export function summarizeGuidanceDiff(result: InstallGuidanceResult): string {
  return [
    `installed=${String(result.installed.length)}`,
    `updated=${String(result.updated.length)}`,
    `skipped=${String(result.skipped.length)}`
  ].join(" ");
}

export function getGuidanceNameFromPath(path: string): string {
  return basename(path);
}
