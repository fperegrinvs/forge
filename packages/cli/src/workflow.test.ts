import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePlanSchema } from "@forge/contracts";
import { migratePlanFile, runWorkflowCheck } from "./workflow.js";

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

  const planPath = join(repo, "plan.json");
  await writeFile(planPath, `${JSON.stringify(validPlan, null, 2)}\n`, "utf8");

  git(repo, "init");
  git(repo, "config", "user.email", "forge@example.com");
  git(repo, "config", "user.name", "Forge");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "init");

  return { repo, planPath };
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
});
