import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { exists, listFilesRecursive } from "@forge/shared-utils";
import type { InstallGuidanceOptions, InstallGuidanceResult, SkillDescriptor } from "./types.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const builtPackRoot = join(currentDir, "assets", "pack");
const sourcePackRoot = join(currentDir, "..", "src", "assets", "pack");
const bundledPackRoot = existsSync(builtPackRoot) ? builtPackRoot : sourcePackRoot;
const policyFile = "workflow-policy.v1.json";

function hashContent(value: string): string {
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

    const sourceContent = await readFile(source, "utf8");

    if (!(await exists(destination))) {
      await cp(source, destination);
      result.installed.push(rel);
      continue;
    }

    const existingContent = await readFile(destination, "utf8");
    if (hashContent(existingContent) === hashContent(sourceContent)) {
      result.skipped.push(rel);
      continue;
    }

    if (options.forceReplace) {
      await writeFile(destination, sourceContent, "utf8");
      result.updated.push(rel);
    } else {
      result.skipped.push(rel);
    }
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
