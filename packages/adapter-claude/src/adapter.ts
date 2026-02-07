import { randomUUID } from "node:crypto";
import { runCommand } from "@forge/shared-utils";
import type { AdapterEvent, AgentAdapter, RunContext, RunHandle } from "@forge/shared-utils";

type CommandExecutor = (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export class ClaudeAdapter implements AgentAdapter {
  private readonly runs = new Map<string, RunContext>();

  constructor(
    private readonly execute: CommandExecutor = runCommand,
    private readonly command = "claude"
  ) {}

  startRun(context: RunContext): Promise<RunHandle> {
    const runId = randomUUID();
    this.runs.set(runId, context);
    return Promise.resolve({ runId });
  }

  async *streamEvents(runId: string): AsyncIterable<AdapterEvent> {
    const context = this.runs.get(runId);
    if (!context) {
      yield {
        type: "run.failed",
        runId,
        reason: "unknown run",
        at: new Date().toISOString()
      };
      return;
    }

    yield { type: "run.started", runId, at: new Date().toISOString() };

    const args = ["-p", context.prompt, "--output-format", "stream-json"];
    const result = await this.execute(this.command, args, context.workingDirectory, context.env ?? {});

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      yield {
        type: "run.output",
        runId,
        stream: "stdout",
        chunk: line,
        at: new Date().toISOString()
      };
    }

    if (result.stderr.trim()) {
      yield {
        type: "run.output",
        runId,
        stream: "stderr",
        chunk: result.stderr.trim(),
        at: new Date().toISOString()
      };
    }

    if (result.exitCode === 0) {
      yield {
        type: "run.completed",
        runId,
        exitCode: 0,
        at: new Date().toISOString()
      };
      return;
    }

    yield {
      type: "run.failed",
      runId,
      reason: `claude exited with code ${String(result.exitCode)}`,
      at: new Date().toISOString()
    };
  }

  resume(runId: string): Promise<RunHandle> {
    if (!this.runs.has(runId)) {
      return Promise.reject(new Error(`run not found: ${runId}`));
    }
    return Promise.resolve({ runId });
  }

  cancel(runId: string): Promise<void> {
    this.runs.delete(runId);
    return Promise.resolve();
  }
}
