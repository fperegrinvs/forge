import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterEvent, AgentAdapter, RunContext } from "@forge/shared-utils";
import { ForgeWorkflowRunner } from "./workflow-runner.js";

const planTemplate = {
  metadata: {
    project: "forge",
    created: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    spec_version: "v2",
    approved: true
  },
  context: {
    goals: ["x"],
    constraints: ["y"],
    tech_decisions: {},
    architecture: "modulith"
  },
  tasks: [
    {
      id: "task-1",
      task_type: "implementation",
      name: "Task 1",
      description: "do things",
      files: ["a.ts"],
      dependencies: [],
      acceptance_criteria: ["ok"],
      verification_command: "echo ok",
      tests: {
        bdd_scenarios: ["Given state When action Then result"],
        property_invariants: [],
        contract_tests: []
      },
      documentation: {
        updates: ["docs/architecture.md"],
        decision_notes: "Initial behavior"
      },
      status: ""
    },
    {
      id: "task-2",
      task_type: "implementation",
      name: "Task 2",
      description: "do more",
      files: ["b.ts"],
      dependencies: ["task-1"],
      acceptance_criteria: ["ok"],
      verification_command: "echo ok",
      tests: {
        bdd_scenarios: ["Given state When action Then result"],
        property_invariants: [],
        contract_tests: []
      },
      documentation: {
        updates: ["docs/architecture.md"],
        decision_notes: "Initial behavior"
      },
      status: ""
    }
  ]
};

function stubAdapter(observed: { contexts: RunContext[] }): AgentAdapter {
  return {
    async startRun(context) {
      observed.contexts.push(context);
      return { runId: `run-${context.taskId}-${String(observed.contexts.length)}` };
    },
    async *streamEvents(runId) {
      yield { type: "run.started", runId, at: new Date().toISOString() } as const;
      yield { type: "run.output", runId, stream: "stdout", chunk: "ok", at: new Date().toISOString() } as const;
      yield { type: "run.completed", runId, exitCode: 0, at: new Date().toISOString() } as const;
    },
    async resume(runId) {
      return { runId, externalRunId: `external-${runId}` };
    },
    async cancel() {
      return;
    }
  };
}

describe("ForgeWorkflowRunner", () => {
  it("runs spec phase first for the next runnable task and records status", async () => {
    // Given a workspace with a simple plan and all gates passing
    const workspace = await mkdtemp(join(tmpdir(), "forge-workflow-runner-"));
    const planPath = join(workspace, "plan.json");
    await writeFile(planPath, JSON.stringify(planTemplate, null, 2), "utf8");
    await mkdir(join(workspace, ".forge"), { recursive: true });

    const observed = { contexts: [] as RunContext[] };
    const runner = new ForgeWorkflowRunner(workspace, () => stubAdapter(observed), {
      gateRunner: async () => ({ ok: true, stdout: "pass", stderr: "", exitCode: 0 }),
      git: {
        async currentBranch() {
          return "codex/test";
        },
        async commit() {
          return;
        },
        async push() {
          return;
        }
      }
    });

    // When we run one workflow step
    const result = await runner.runAuto(planPath, "codex", { maxRetries: 1, push: false });

    // Then it starts with the first runnable task in spec phase
    expect(result.state).toBe("running");
    expect(result.taskId).toBe("task-1");
    expect(result.phase).toBe("spec");
    expect(observed.contexts[0]?.taskId).toBe("task-1");
    expect(observed.contexts[0]?.prompt).toContain("Phase: spec");

    // And it records spec completion status into the plan file
    const updated = JSON.parse(await readFile(planPath, "utf8")) as typeof planTemplate;
    expect(updated.tasks[0]?.status).toBe("spec");
    expect(updated.tasks[1]?.status).toBe("");
  });

  it("skips blocked tasks until dependencies are completed", async () => {
    // Given a plan where task-1 is completed
    const workspace = await mkdtemp(join(tmpdir(), "forge-workflow-runner-deps-"));
    const plan = structuredClone(planTemplate);
    plan.tasks[0]!.status = "completed";
    const planPath = join(workspace, "plan.json");
    await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
    await mkdir(join(workspace, ".forge"), { recursive: true });

    const observed = { contexts: [] as RunContext[] };
    const runner = new ForgeWorkflowRunner(workspace, () => stubAdapter(observed), {
      gateRunner: async () => ({ ok: true, stdout: "pass", stderr: "", exitCode: 0 }),
      git: {
        async currentBranch() {
          return "codex/test";
        },
        async commit() {
          return;
        },
        async push() {
          return;
        }
      }
    });

    // When we run one workflow step
    const result = await runner.runAuto(planPath, "codex", { maxRetries: 1, push: false });

    // Then it picks task-2 as runnable and starts at spec
    expect(result.state).toBe("running");
    expect(result.taskId).toBe("task-2");
    expect(result.phase).toBe("spec");
  });

  it("retries a phase when the gate fails and pauses after max retries", async () => {
    // Given a gate that fails twice
    const workspace = await mkdtemp(join(tmpdir(), "forge-workflow-runner-retry-"));
    const planPath = join(workspace, "plan.json");
    await writeFile(planPath, JSON.stringify(planTemplate, null, 2), "utf8");
    await mkdir(join(workspace, ".forge"), { recursive: true });

    const observed = { contexts: [] as RunContext[] };
    let attempts = 0;
    const events: AdapterEvent[] = [];
    const adapter = stubAdapter(observed);
    const runner = new ForgeWorkflowRunner(workspace, () => adapter, {
      gateRunner: async () => {
        attempts += 1;
        return { ok: false, stdout: "nope", stderr: "", exitCode: 1, name: "gate" };
      },
      git: {
        async currentBranch() {
          return "codex/test";
        },
        async commit() {
          return;
        },
        async push() {
          return;
        }
      },
      onAdapterEvent: (event) => events.push(event)
    });

    // When we run auto with maxRetries=2
    const result = await runner.runAuto(planPath, "codex", { maxRetries: 2, push: false });

    // Then it pauses the workflow after exhausting retries
    expect(result.state).toBe("paused");
    expect(result.taskId).toBe("task-1");
    expect(result.phase).toBe("spec");
    expect(attempts).toBe(2);
  });
});

