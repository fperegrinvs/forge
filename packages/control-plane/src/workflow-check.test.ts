import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePlanSchema } from "@forge/contracts";
import { migratePlanFile, runWorkflowCheck } from "./workflow-check.js";

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

const validPlan = {
  metadata: {
    project: "forge",
    created: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    spec_version: "v2",
    approved: true
  },
  context: {
    goals: ["goal"],
    constraints: ["constraint"],
    tech_decisions: {},
    architecture: "modulith"
  },
  tasks: [
    {
      id: "task-1",
      task_type: "implementation",
      name: "Task",
      description: "desc",
      files: ["src/a.ts"],
      dependencies: [],
      acceptance_criteria: ["done"],
      verification_command: "echo ok",
      tests: {
        bdd_scenarios: ["Given X When Y Then Z"],
        property_invariants: [],
        contract_tests: []
      },
      documentation: {
        updates: ["docs/architecture.md"],
        decision_notes: "note"
      }
    }
  ]
};

async function initRepo(): Promise<{ repo: string; planPath: string }> {
  const repo = await mkdtemp(join(tmpdir(), "forge-workflow-cli-"));
  await mkdir(join(repo, "checks", "task-types", "implementation"), { recursive: true });
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "tests"), { recursive: true });
  await mkdir(join(repo, "docs"), { recursive: true });

  await writeFile(join(repo, "checks", "task-types", "implementation", "gate-green.sh"), "#!/usr/bin/env bash\n", "utf8");
  await writeFile(join(repo, "src", "a.ts"), "export const a = 1;\n", "utf8");
  await writeFile(
    join(repo, "tests", "a.test.ts"),
    "describe('a', () => {\n  // Given baseline\n  // When value is read\n  // Then it matches\n});\n",
    "utf8"
  );
  await writeFile(join(repo, "docs", "architecture.md"), "initial\n", "utf8");
  await writeFile(join(repo, "decisions.md"), "# Decisions\n\n## 2026-02-07\n- Initial setup.\n", "utf8");

  const planPath = join(repo, "plan.json");
  await writeFile(planPath, `${JSON.stringify(validPlan, null, 2)}\n`, "utf8");

  git(repo, "init");
  git(repo, "config", "user.email", "forge@example.com");
  git(repo, "config", "user.name", "Forge");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "init");

  return { repo, planPath };
}

function bddBody(extra = ""): string {
  return [
    "describe('x', () => {",
    "  // Given preconditions",
    "  // When running behavior",
    "  // Then expected results",
    extra,
    "});",
    ""
  ].join("\n");
}

describe("workflow", () => {
  it("migrates legacy plan files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-plan-migrate-"));
    const planPath = join(dir, "plan.json");
    const legacyPlan = {
      ...validPlan,
      metadata: {
        ...validPlan.metadata,
        spec_version: "v1"
      },
      tasks: [
        {
          id: "task-1",
          task_type: "implementation",
          name: "Task",
          description: "desc",
          files: ["src/a.ts"],
          dependencies: [],
          acceptance_criteria: ["done"],
          verification_command: "echo ok"
        }
      ]
    };

    await writeFile(planPath, `${JSON.stringify(legacyPlan, null, 2)}\n`, "utf8");

    const result = await migratePlanFile(planPath, true);
    expect(result.migrated).toBe(true);
    expect(result.wrote).toBe(true);

    const validation = await validatePlanSchema(JSON.parse(await readFile(planPath, "utf8")));
    expect(validation.valid).toBe(true);
  });

  it("fails when source changes are missing tests and docs", async () => {
    const { repo, planPath } = await initRepo();

    await writeFile(join(repo, "src", "a.ts"), "export const a = 2;\n", "utf8");
    const result = await runWorkflowCheck(repo, planPath, "HEAD");

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "workflow_tests_missing")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "workflow_docs_missing")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "workflow_decisions_missing")).toBe(true);
  });

  it("fails when source changes include docs but omit decisions.md", async () => {
    const { repo, planPath } = await initRepo();

    await writeFile(join(repo, "src", "a.ts"), "export const a = 2;\n", "utf8");
    await writeFile(
      join(repo, "tests", "a.test.ts"),
      "describe('a', () => {\n  // Given baseline\n  // When value changes\n  // Then it matches\n});\n",
      "utf8"
    );
    await writeFile(join(repo, "docs", "architecture.md"), "updated\n", "utf8");

    const result = await runWorkflowCheck(repo, planPath, "HEAD");
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "workflow_decisions_missing")).toBe(true);
  });

  it("passes when source changes include tests docs and decisions.md", async () => {
    const { repo, planPath } = await initRepo();

    await writeFile(join(repo, "src", "a.ts"), "export const a = 2;\n", "utf8");
    await writeFile(
      join(repo, "tests", "a.test.ts"),
      "describe('a', () => {\n  // Given baseline\n  // When value changes\n  // Then it matches\n});\n",
      "utf8"
    );
    await writeFile(join(repo, "docs", "architecture.md"), "updated\n", "utf8");
    await writeFile(join(repo, "decisions.md"), "# Decisions\n\n## 2026-02-08\n- Updated behavior.\n", "utf8");

    const result = await runWorkflowCheck(repo, planPath, "HEAD");
    expect(result.valid).toBe(true);
  });

  it("fails when changed tests do not contain bdd markers", async () => {
    const { repo, planPath } = await initRepo();

    await writeFile(join(repo, "tests", "a.test.ts"), "describe('a', () => { expect(1).toBe(1); });\n", "utf8");
    const result = await runWorkflowCheck(repo, planPath, "HEAD");

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "workflow_bdd_markers_missing")).toBe(true);
  });

  it("passes on docs-only changes", async () => {
    const { repo, planPath } = await initRepo();

    await writeFile(join(repo, "docs", "architecture.md"), "updated\n", "utf8");
    const result = await runWorkflowCheck(repo, planPath, "HEAD");

    expect(result.valid).toBe(true);
  });

  it("fails when mock is unannotated", async () => {
    const { repo, planPath } = await initRepo();

    await writeFile(join(repo, "tests", "a.test.ts"), bddBody("  vi.mock('x', () => ({}));"), "utf8");
    const result = await runWorkflowCheck(repo, planPath, "HEAD");

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "workflow_mock_unannotated")).toBe(true);
  });

  it("fails when mock annotation reason is invalid", async () => {
    const { repo, planPath } = await initRepo();

    await writeFile(
      join(repo, "tests", "a.test.ts"),
      bddBody("  // forge-mock: perf_testing\n  vi.mock('x', () => ({}));"),
      "utf8"
    );
    const result = await runWorkflowCheck(repo, planPath, "HEAD");

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "workflow_mock_invalid_reason")).toBe(true);
  });

  it("fails when adapter_boundary mock is outside allowed boundary paths", async () => {
    const { repo, planPath } = await initRepo();

    await writeFile(
      join(repo, "tests", "a.test.ts"),
      bddBody("  // forge-mock: adapter_boundary\n  vi.mock('x', () => ({}));"),
      "utf8"
    );
    const result = await runWorkflowCheck(repo, planPath, "HEAD");

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "workflow_mock_boundary_violation")).toBe(true);
  });

  it("passes when failure_simulation mock annotation is present", async () => {
    const { repo, planPath } = await initRepo();

    await writeFile(
      join(repo, "tests", "a.test.ts"),
      bddBody("  // forge-mock: failure_simulation\n  vi.mock('x', () => ({}));"),
      "utf8"
    );
    const result = await runWorkflowCheck(repo, planPath, "HEAD");

    expect(result.valid).toBe(true);
  });

  it("passes when adapter_boundary mock annotation is in allowed boundary paths", async () => {
    const { repo, planPath } = await initRepo();
    await mkdir(join(repo, "apps", "desktop", "src", "composables"), { recursive: true });

    await writeFile(
      join(repo, "apps", "desktop", "src", "composables", "useControlPlane.test.ts"),
      bddBody("  // forge-mock: adapter_boundary\n  vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve() }));"),
      "utf8"
    );
    const result = await runWorkflowCheck(repo, planPath, "HEAD");

    expect(result.valid).toBe(true);
  });
});
