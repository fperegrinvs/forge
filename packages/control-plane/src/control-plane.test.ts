import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmod } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ForgeControlPlane } from "./control-plane.js";

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

  it("does not run next task while a run is paused", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "forge-control-plane-pause-gate-"));
    const checksDir = join(workspace, "checks", "task-types", "implementation");
    await mkdir(checksDir, { recursive: true });
    const script = join(checksDir, "gate-green.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho fail\nexit 1\n", "utf8");
    await chmod(script, 0o755);

    const planPath = join(workspace, "plan.json");
    await writeFile(planPath, JSON.stringify(planTemplate), "utf8");

    const controlPlane = new ForgeControlPlane(workspace, () => ({
      async startRun() {
        return { runId: "run-4" };
      },
      async *streamEvents() {
        yield { type: "run.started", runId: "run-4", at: new Date().toISOString() } as const;
        yield { type: "run.completed", runId: "run-4", exitCode: 0, at: new Date().toISOString() } as const;
      },
      async resume() {
        return { runId: "run-4", externalRunId: "thread-4" };
      },
      async cancel() {
        return;
      }
    }));

    const first = await controlPlane.runNext(planPath, "codex", join(workspace, "checks", "task-types"));
    expect(first.state).toBe("paused");

    const second = await controlPlane.runNext(planPath, "codex", join(workspace, "checks", "task-types"));
    expect(second.state).toBe("paused");
    expect(second.runId).toBe("run-4");
  });
});
