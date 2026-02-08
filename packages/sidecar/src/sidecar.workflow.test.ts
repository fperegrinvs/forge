import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// forge-mock: failure_simulation
vi.mock("@forge/adapter-codex", () => {
  class CodexAppServerAdapter {
    private runs = 0;

    async startRun() {
      this.runs += 1;
      return { runId: `run-${this.runs}` };
    }

    async *streamEvents(runId: string) {
      yield { type: "run.started", runId, at: new Date().toISOString() } as const;
      yield { type: "run.completed", runId, exitCode: 0, at: new Date().toISOString() } as const;
    }

    async resume(runId: string) {
      return { runId, externalRunId: `external-${runId}` };
    }

    async cancel() {
      return;
    }
  }

  return { CodexAppServerAdapter };
});

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as unknown as typeof process.stdout.write;

  try {
    await run();
    return chunks.join("");
  } finally {
    process.stdout.write = original;
  }
}

describe("sidecar workflow.auto.stream", () => {
  it("runs a full single-task workflow and emits JSONL events", async () => {
    // Given a workspace git repo on a non-main branch with a plan and phase gates
    const workspace = await mkdtemp(join(tmpdir(), "forge-sidecar-workflow-"));
    await mkdir(join(workspace, ".forge"), { recursive: true });

    await writeFile(join(workspace, "gate.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await writeFile(
      join(workspace, ".forge", "phase-gates.json"),
      `${JSON.stringify(
        {
          spec: "gate.sh",
          implement: "gate.sh",
          refactor: "gate.sh",
          document: "gate.sh",
          commit: "gate.sh"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const planPath = join(workspace, "plan.json");
    await writeFile(
      planPath,
      `${JSON.stringify(
        {
          tasks: [
            {
              id: "task-1",
              task_type: "implementation",
              name: "Task",
              description: "desc",
              dependencies: []
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    git(workspace, "init", "-b", "codex/test");
    git(workspace, "config", "user.email", "forge@example.com");
    git(workspace, "config", "user.name", "Forge");
    git(workspace, "add", ".");
    git(workspace, "commit", "-m", "init");

    // Import after mocks so adapter resolution uses the fake.
    const { runSidecarCommandWithCwd } = await import("./sidecar.js");

    const stdout = await captureStdout(async () => {
      // When workflow auto is started
      await runSidecarCommandWithCwd(workspace, {
        command: "workflow.auto.stream",
        params: { planPath: "plan.json", adapter: "codex", push: false }
      });
    });

    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    // Then it emits lifecycle markers and step updates
    expect(lines.some((l) => l.type === "workflow.auto.started")).toBe(true);
    expect(lines.some((l) => l.type === "workflow.auto.step")).toBe(true);
    expect(lines.some((l) => l.type === "adapter.event")).toBe(true);
    expect(lines.some((l) => l.type === "workflow.auto.completed")).toBe(true);

    // And the plan file is updated to completed
    const updated = JSON.parse(await readFile(planPath, "utf8"));
    expect(updated.tasks[0].status).toBe("completed");
  });
});

