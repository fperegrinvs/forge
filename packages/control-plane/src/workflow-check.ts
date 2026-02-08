import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { loadBundledWorkflowPolicy } from "@forge/guidance-pack";
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
const directMockPrimitivePattern = /^\s*(?:await\s+)?(?:vi|jest)\.(?:mock|spyOn)\s*\(/;
const assignedMockPrimitivePattern =
  /^\s*(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:await\s+)?(?:vi|jest)\.(?:mock|spyOn)\s*\(/;

type MockPolicy = {
  mockAnnotationTag: string;
  allowedReasons: Set<string>;
  boundaryGlobs: string[];
};

type MockUsage = {
  line: number;
  reason?: string;
};

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

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";

  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      const next = glob[i + 1];
      if (next === "*") {
        pattern += ".*";
        i += 1;
      } else {
        pattern += "[^/]*";
      }
      continue;
    }

    pattern += escapeRegExp(char ?? "");
  }

  pattern += "$";
  return new RegExp(pattern);
}

function matchesAnyGlob(path: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

function annotationRegex(tag: string): RegExp {
  return new RegExp(`//\\s*${escapeRegExp(tag)}\\s*:\\s*([a-z_]+)`);
}

function findAnnotationReason(lines: string[], lineIndex: number, tag: string): string | undefined {
  const rx = annotationRegex(tag);
  const candidateIndexes = [lineIndex - 1, lineIndex, lineIndex + 1];

  for (const idx of candidateIndexes) {
    if (idx < 0 || idx >= lines.length) {
      continue;
    }

    const match = rx.exec(lines[idx] ?? "");
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function extractMockUsages(content: string, tag: string): MockUsage[] {
  const lines = content.split("\n");
  const usages: MockUsage[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!directMockPrimitivePattern.test(line) && !assignedMockPrimitivePattern.test(line)) {
      continue;
    }

    const reason = findAnnotationReason(lines, i, tag);
    usages.push({
      line: i + 1,
      ...(reason ? { reason } : {})
    });
  }

  return usages;
}

function normalizeMockPolicy(policy: Record<string, unknown>): MockPolicy {
  const quality = (policy.quality ?? {}) as Record<string, unknown>;

  const mockAnnotationTag =
    typeof quality.mock_annotation_tag === "string" ? quality.mock_annotation_tag : "forge-mock";
  const allowList = Array.isArray(quality.allow_mocks_only_for)
    ? quality.allow_mocks_only_for.filter((item): item is string => typeof item === "string")
    : ["adapter_boundary", "failure_simulation"];
  const boundaryGlobs = Array.isArray(quality.mock_boundary_test_globs)
    ? quality.mock_boundary_test_globs.filter((item): item is string => typeof item === "string")
    : [];

  return {
    mockAnnotationTag,
    allowedReasons: new Set(allowList),
    boundaryGlobs
  };
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
  const mockPolicy = normalizeMockPolicy(await loadBundledWorkflowPolicy());

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
    const graphValidation = validatePlanGraph(plan);
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

  if (changed.source.length > 0 && !changed.docs.includes("decisions.md")) {
    issues.push({
      path: "/changed/decisions",
      message: "Source files changed without updating decisions.md.",
      code: "workflow_decisions_missing"
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

    for (const testFile of changed.tests) {
      const fullPath = resolve(workspaceRoot, testFile);
      if (!(await exists(fullPath))) {
        continue;
      }

      const content = await readFile(fullPath, "utf8");
      const mockUsages = extractMockUsages(content, mockPolicy.mockAnnotationTag);

      for (const usage of mockUsages) {
        if (!usage.reason) {
          issues.push({
            path: `/${testFile}:${String(usage.line)}`,
            message: `Mock call requires annotation '// ${mockPolicy.mockAnnotationTag}: <reason>'.`,
            code: "workflow_mock_unannotated"
          });
          continue;
        }

        if (!mockPolicy.allowedReasons.has(usage.reason)) {
          issues.push({
            path: `/${testFile}:${String(usage.line)}`,
            message: `Mock annotation reason '${usage.reason}' is not allowed.`,
            code: "workflow_mock_invalid_reason"
          });
          continue;
        }

        if (usage.reason === "adapter_boundary" && !matchesAnyGlob(testFile, mockPolicy.boundaryGlobs)) {
          issues.push({
            path: `/${testFile}:${String(usage.line)}`,
            message: "adapter_boundary mock annotation is only allowed in adapter-boundary test files.",
            code: "workflow_mock_boundary_violation"
          });
        }
      }
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
