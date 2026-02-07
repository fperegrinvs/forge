import { readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { loadTaskTypeRegistry } from "@forge/check-runner";
import {
  CURRENT_PLAN_SPEC_VERSION,
  loadPlan,
  migratePlanToCurrentSpec,
  validatePlanGraph,
  validatePlanSchema,
  validatePlanWorkflow
} from "@forge/contracts";
import { exists, readJsonFile, runCommand, writeJsonFile } from "@forge/shared-utils";

type ValidationIssueLike = {
  path: string;
  message: string;
  code: string;
};

export type WorkflowCheckResult = {
  valid: boolean;
  baseRef: string;
  issues: ValidationIssueLike[];
  changed: {
    source: string[];
    tests: string[];
    docs: string[];
  };
};

export type PlanMigrationResult = {
  migrated: boolean;
  wrote: boolean;
  filePath: string;
  fromSpecVersion?: string;
  toSpecVersion: string;
};

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".vue", ".rs"]);

function getSpecVersion(plan: unknown): string | undefined {
  if (!plan || typeof plan !== "object") {
    return undefined;
  }

  const metadata = (plan as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const specVersion = (metadata as Record<string, unknown>).spec_version;
  return typeof specVersion === "string" ? specVersion : undefined;
}

function isDocumentationFile(path: string): boolean {
  return path === "decisions.md" || (path.startsWith("docs/") && path.endsWith(".md"));
}

function isTestFile(path: string): boolean {
  return (
    path.includes("/tests/") ||
    path.startsWith("tests/") ||
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    path.endsWith(".spec.ts") ||
    path.endsWith(".spec.tsx") ||
    path.endsWith(".property.test.ts") ||
    /contracts\/.+\.contract\.test\.ts$/.test(path)
  );
}

function isSourceFile(path: string): boolean {
  if (isDocumentationFile(path) || isTestFile(path)) {
    return false;
  }

  return sourceExtensions.has(extname(path));
}

async function readChangedFiles(workspaceRoot: string, baseRef: string): Promise<string[]> {
  const args =
    baseRef === "HEAD"
      ? ["diff", "--name-only", "HEAD"]
      : ["diff", "--name-only", `${baseRef}...HEAD`];
  const range = `${baseRef}...HEAD`;
  const diff = await runCommand("git", args, workspaceRoot);
  if (diff.exitCode !== 0) {
    throw new Error(`Unable to compute git diff for ${range}: ${diff.stderr || diff.stdout}`);
  }

  const trackedChanges = diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const untracked = await runCommand(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    workspaceRoot
  );
  if (untracked.exitCode !== 0) {
    throw new Error(`Unable to list untracked files: ${untracked.stderr || untracked.stdout}`);
  }

  const untrackedChanges = untracked.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return [...new Set([...trackedChanges, ...untrackedChanges])];
}

async function readChangedFilesWithFallback(workspaceRoot: string, baseRef: string): Promise<string[]> {
  try {
    return await readChangedFiles(workspaceRoot, baseRef);
  } catch (error) {
    if (baseRef !== "HEAD") {
      throw error;
    }

    const diff = await runCommand("git", ["diff", "--name-only", "HEAD"], workspaceRoot);
    if (diff.exitCode !== 0) {
      throw new Error(`Unable to compute git diff for HEAD: ${diff.stderr || diff.stdout}`);
    }

    return diff.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
}

function defaultBaseRef(baseRef?: string): string {
  if (baseRef) {
    return baseRef;
  }

  return process.env.CI ? "origin/main" : "HEAD";
}

async function changedTestsContainBddMarkers(workspaceRoot: string, testFiles: string[]): Promise<boolean> {
  for (const testFile of testFiles) {
    const fullPath = resolve(workspaceRoot, testFile);
    if (!(await exists(fullPath))) {
      continue;
    }

    const content = await readFile(fullPath, "utf8");
    if (/\bGiven\b/.test(content) && /\bWhen\b/.test(content) && /\bThen\b/.test(content)) {
      return true;
    }
  }

  return false;
}

function toIssues(issues: ValidationIssueLike[]): ValidationIssueLike[] {
  return issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code
  }));
}

export async function runWorkflowCheck(
  workspaceRoot: string,
  planPath: string,
  baseRefInput?: string
): Promise<WorkflowCheckResult> {
  const baseRef = defaultBaseRef(baseRefInput);
  const schemaValidation = await validatePlanSchema(await readJsonFile<unknown>(planPath));

  const issues: ValidationIssueLike[] = [];
  issues.push(...toIssues(schemaValidation.issues));

  const changedFiles = await readChangedFilesWithFallback(workspaceRoot, baseRef);
  const changed = {
    source: changedFiles.filter((file) => isSourceFile(file)),
    tests: changedFiles.filter((file) => isTestFile(file)),
    docs: changedFiles.filter((file) => isDocumentationFile(file))
  };

  if (schemaValidation.valid) {
    const plan = await loadPlan(planPath);
    const checkRoot = join(workspaceRoot, "checks", "task-types");
    const registry = await loadTaskTypeRegistry(checkRoot);

    const graphValidation = validatePlanGraph(plan, new Set(registry.keys()));
    const workflowValidation = validatePlanWorkflow(plan);

    issues.push(...toIssues(graphValidation.issues));
    issues.push(...toIssues(workflowValidation.issues));
  }

  if (changed.source.length > 0 && changed.tests.length === 0) {
    issues.push({
      path: "/changed/tests",
      message: "Source files changed without corresponding test file changes.",
      code: "workflow_tests_missing"
    });
  }

  if (changed.source.length > 0 && changed.docs.length === 0) {
    issues.push({
      path: "/changed/docs",
      message: "Source files changed without documentation updates in docs/**/*.md or decisions.md.",
      code: "workflow_docs_missing"
    });
  }

  if (changed.tests.length > 0) {
    const hasBddMarkers = await changedTestsContainBddMarkers(workspaceRoot, changed.tests);
    if (!hasBddMarkers) {
      issues.push({
        path: "/changed/tests",
        message: "Changed tests must include Given/When/Then markers for code-first BDD.",
        code: "workflow_bdd_markers_missing"
      });
    }
  }

  return {
    valid: issues.length === 0,
    baseRef,
    issues,
    changed
  };
}

export async function migratePlanFile(filePath: string, write = false): Promise<PlanMigrationResult> {
  const absolutePath = resolve(filePath);
  const raw = await readJsonFile<unknown>(absolutePath);
  const fromSpecVersion = getSpecVersion(raw);

  if (fromSpecVersion === CURRENT_PLAN_SPEC_VERSION) {
    return {
      migrated: false,
      wrote: false,
      filePath: absolutePath,
      fromSpecVersion,
      toSpecVersion: CURRENT_PLAN_SPEC_VERSION
    };
  }

  const migratedPlan = migratePlanToCurrentSpec(raw as Parameters<typeof migratePlanToCurrentSpec>[0]);
  if (write) {
    await writeJsonFile(absolutePath, migratedPlan);
  }

  const result: PlanMigrationResult = {
    migrated: true,
    wrote: write,
    filePath: absolutePath,
    toSpecVersion: CURRENT_PLAN_SPEC_VERSION
  };

  if (fromSpecVersion) {
    result.fromSpecVersion = fromSpecVersion;
  }

  return result;
}

export function formatWorkflowCheckSummary(result: WorkflowCheckResult): string {
  if (result.valid) {
    return `Workflow check passed (baseRef=${result.baseRef}, source=${String(result.changed.source.length)}, tests=${String(result.changed.tests.length)}, docs=${String(result.changed.docs.length)})`;
  }

  const issueSummary = result.issues
    .map((issue) => `[${issue.code}] ${issue.path}: ${issue.message}`)
    .join("\n");

  return `Workflow check failed (baseRef=${result.baseRef})\n${issueSummary}`;
}

export function formatMigrationSummary(result: PlanMigrationResult): string {
  if (!result.migrated) {
    return `${basename(result.filePath)} is already on ${result.toSpecVersion}`;
  }

  if (result.wrote) {
    return `Migrated ${basename(result.filePath)} from ${result.fromSpecVersion ?? "unknown"} to ${result.toSpecVersion}`;
  }

  return `Plan at ${basename(result.filePath)} can be migrated from ${result.fromSpecVersion ?? "unknown"} to ${result.toSpecVersion}; rerun with --write`;
}
