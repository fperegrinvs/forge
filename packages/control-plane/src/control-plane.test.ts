import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmod } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ForgeControlPlane } from "./control-plane.js";
import "./index.js";
import type { RunContext } from "@forge/shared-utils";

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
      name: "Task",
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
      }
    }
  ]
};

describe("ForgeControlPlane", () => {
  it("uses full-auto approval mode when stdin is not a TTY (non-interactive)", async () => {
    // Given a non-interactive environment (no TTY)
    const originalIsTTY = process.stdin.isTTY;
    try {
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

      // And a workspace with a passing gate
      const workspace = await mkdtemp(join(tmpdir(), "forge-control-plane-approval-"));
      const checksDir = join(workspace, "checks", "task-types", "implementation");
      await mkdir(checksDir, { recursive: true });
      const script = join(checksDir, "gate-green.sh");
      await writeFile(script, "#!/usr/bin/env bash\necho pass\n", "utf8");
      await chmod(script, 0o755);

      const planPath = join(workspace, "plan.json");
      await writeFile(planPath, JSON.stringify(planTemplate), "utf8");

      // When runNext starts a run
      let observed: RunContext["approvalMode"] | undefined;
      const controlPlane = new ForgeControlPlane(workspace, () => ({
        async startRun(context) {
          observed = context.approvalMode;
          return { runId: "run-approval" };
        },
        async *streamEvents() {
          yield { type: "run.started", runId: "run-approval", at: new Date().toISOString() } as const;
          yield { type: "run.completed", runId: "run-approval", exitCode: 0, at: new Date().toISOString() } as const;
        },
        async resume() {
          return { runId: "run-approval" };
        },
        async cancel() {
          return;
        }
      }));

      await controlPlane.runNext(planPath, "codex", join(workspace, "checks", "task-types"));

      // Then it uses full-auto to avoid interactive approval deadlocks
      expect(observed).toBe("full-auto");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });

  it("streams adapter events via onAdapterEvent hook", async () => {
    // Given a workspace with a passing gate script
    const workspace = await mkdtemp(join(tmpdir(), "forge-control-plane-hooks-"));
    const checksDir = join(workspace, "checks", "task-types", "implementation");
    await mkdir(checksDir, { recursive: true });
    const script = join(checksDir, "gate-green.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho pass\n", "utf8");
    await chmod(script, 0o755);

    // And a plan with a single runnable task
    const planPath = join(workspace, "plan.json");
    await writeFile(planPath, JSON.stringify(planTemplate), "utf8");

    // When runNext is executed with an onAdapterEvent hook
    const observed: string[] = [];
    const controlPlane = new ForgeControlPlane(workspace, () => ({
      async startRun() {
        return { runId: "run-hooks" };
      },
      async *streamEvents() {
        yield { type: "run.started", runId: "run-hooks", at: new Date().toISOString() } as const;
        yield {
          type: "run.output",
          runId: "run-hooks",
          stream: "stdout",
          chunk: "hello",
          at: new Date().toISOString()
        } as const;
        yield { type: "run.completed", runId: "run-hooks", exitCode: 0, at: new Date().toISOString() } as const;
      },
      async resume() {
        return { runId: "run-hooks" };
      },
      async cancel() {
        return;
      }
    }));

    const result = await controlPlane.runNext(planPath, "codex", join(workspace, "checks", "task-types"), {
      onAdapterEvent: (event) => {
        observed.push(event.type);
      }
    });

    // Then the hook receives adapter events as they occur
    expect(result.state).toBe("completed");
    expect(observed).toEqual(["run.started", "run.output", "run.completed"]);
  });

  it("runs next task and updates status", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "forge-control-plane-"));
    const checksDir = join(workspace, "checks", "task-types", "implementation");
    await mkdir(checksDir, { recursive: true });
    const script = join(checksDir, "gate-green.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho pass\n", "utf8");
    await chmod(script, 0o755);

    const planPath = join(workspace, "plan.json");
    await writeFile(planPath, JSON.stringify(planTemplate), "utf8");

    const controlPlane = new ForgeControlPlane(workspace, () => ({
      async startRun() {
        return { runId: "run-1" };
      },
      async *streamEvents() {
        yield { type: "run.started", runId: "run-1", at: new Date().toISOString() } as const;
        yield { type: "run.completed", runId: "run-1", exitCode: 0, at: new Date().toISOString() } as const;
      },
      async resume() {
        return { runId: "run-1", externalRunId: "thread-1" };
      },
      async cancel() {
        return;
      }
    }));

    const result = await controlPlane.runNext(planPath, "codex", join(workspace, "checks", "task-types"));
    expect(result.state).toBe("completed");
    expect(result.externalRunId).toBe("thread-1");
  });

  it("pauses task on failing checks with structural classification", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "forge-control-plane-fail-"));
    const checksDir = join(workspace, "checks", "task-types", "implementation");
    await mkdir(checksDir, { recursive: true });
    const script = join(checksDir, "gate-green.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho fail\nexit 1\n", "utf8");
    await chmod(script, 0o755);

    const planPath = join(workspace, "plan.json");
    await writeFile(planPath, JSON.stringify(planTemplate), "utf8");

    const controlPlane = new ForgeControlPlane(workspace, () => ({
      async startRun() {
        return { runId: "run-2" };
      },
      async *streamEvents() {
        yield { type: "run.started", runId: "run-2", at: new Date().toISOString() } as const;
        yield { type: "run.completed", runId: "run-2", exitCode: 0, at: new Date().toISOString() } as const;
      },
      async resume() {
        return { runId: "run-2", externalRunId: "thread-2" };
      },
      async cancel() {
        return;
      }
    }));

    const result = await controlPlane.runNext(planPath, "codex", join(workspace, "checks", "task-types"));
    expect(result.state).toBe("paused");
    expect(result.classification).toBe("structural");
    expect(result.externalRunId).toBe("thread-2");
    expect(result.resumeCommand).toBe("codex resume thread-2");
  });

  it("resumes paused run by run id", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "forge-control-plane-resume-"));
    const controlPlane = new ForgeControlPlane(workspace, () => ({
      async startRun() {
        return { runId: "run-3", externalRunId: "thread-3" };
      },
      async *streamEvents() {
        yield { type: "run.started", runId: "run-3", at: new Date().toISOString() } as const;
        yield { type: "run.completed", runId: "run-3", exitCode: 0, at: new Date().toISOString() } as const;
      },
      async resume() {
        return { runId: "run-3", externalRunId: "thread-3" };
      },
      async cancel() {
        return;
      }
    }));

    await controlPlane.pause("run-3");
    const resumed = await controlPlane.resume("run-3");
    expect(resumed).toBe(true);
  });

  it("auto-resumes paused run and executes next task", async () => {
    // Given a workspace with a check script that initially fails
    const workspace = await mkdtemp(join(tmpdir(), "forge-control-plane-pause-gate-"));
    const checksDir = join(workspace, "checks", "task-types", "implementation");
    await mkdir(checksDir, { recursive: true });
    const script = join(checksDir, "gate-green.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho fail\nexit 1\n", "utf8");
    await chmod(script, 0o755);

    const planPath = join(workspace, "plan.json");
    await writeFile(planPath, JSON.stringify(planTemplate), "utf8");

    let runCounter = 0;
    const controlPlane = new ForgeControlPlane(workspace, () => ({
      async startRun() {
        runCounter++;
        return { runId: `run-${String(runCounter)}` };
      },
      async *streamEvents() {
        yield { type: "run.started", runId: `run-${String(runCounter)}`, at: new Date().toISOString() } as const;
        yield { type: "run.completed", runId: `run-${String(runCounter)}`, exitCode: 0, at: new Date().toISOString() } as const;
      },
      async resume() {
        return { runId: `run-${String(runCounter)}`, externalRunId: `thread-${String(runCounter)}` };
      },
      async cancel() {
        return;
      }
    }));

    // When runNext is called and checks fail, the task pauses
    const first = await controlPlane.runNext(planPath, "codex", join(workspace, "checks", "task-types"));
    expect(first.state).toBe("paused");

    // When the check script is fixed and runNext is called again
    await writeFile(script, "#!/usr/bin/env bash\necho pass\n", "utf8");

    // Then runNext auto-resumes the paused run and completes
    const second = await controlPlane.runNext(planPath, "codex", join(workspace, "checks", "task-types"));
    expect(second.state).toBe("completed");
    expect(second.taskId).toBe("task-1");
  });

  it("auto-resumes then re-pauses on new failure", async () => {
    // Given a workspace pre-seeded with a paused run and failing checks
    const workspace = await mkdtemp(join(tmpdir(), "forge-control-plane-repauses-"));
    const checksDir = join(workspace, "checks", "task-types", "implementation");
    await mkdir(checksDir, { recursive: true });
    const script = join(checksDir, "gate-green.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho fail\nexit 1\n", "utf8");
    await chmod(script, 0o755);

    const planPath = join(workspace, "plan.json");
    await writeFile(planPath, JSON.stringify(planTemplate), "utf8");

    // Pre-seed state with a paused run
    await mkdir(join(workspace, ".forge"), { recursive: true });
    await writeFile(
      join(workspace, ".forge", "state.json"),
      JSON.stringify({
        planPath,
        tasks: { "task-1": "paused" },
        pausedRun: { runId: "old-run", taskId: "task-1", adapterType: "codex" }
      }),
      "utf8"
    );

    const controlPlane = new ForgeControlPlane(workspace, () => ({
      async startRun() {
        return { runId: "run-retry" };
      },
      async *streamEvents() {
        yield { type: "run.started", runId: "run-retry", at: new Date().toISOString() } as const;
        yield { type: "run.completed", runId: "run-retry", exitCode: 0, at: new Date().toISOString() } as const;
      },
      async resume() {
        return { runId: "run-retry", externalRunId: "thread-retry" };
      },
      async cancel() {
        return;
      }
    }));

    // When runNext is called on a paused run with still-failing checks
    const result = await controlPlane.runNext(planPath, "codex", join(workspace, "checks", "task-types"));

    // Then it auto-resumes, re-runs the task, and pauses again
    expect(result.state).toBe("paused");
    expect(result.classification).toBe("structural");
    expect(result.taskId).toBe("task-1");
  });
});
