import { randomUUID } from "node:crypto";
import { runCommand } from "@forge/shared-utils";
import type { AdapterEvent, AgentAdapter, RunContext, RunHandle } from "@forge/shared-utils";

type CommandExecutor = (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

type RunState = {
  context: RunContext;
  externalRunId?: string;
};

const externalRunIdKeys = new Set(["thread_id", "threadId", "session_id", "sessionId"]);

function extractExternalRunId(payload: unknown): string | undefined {
  const queue: unknown[] = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (externalRunIdKeys.has(key) && typeof value === "string" && value.trim().length > 0) {
        return value;
      }

      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return undefined;
}

export class CodexAdapter implements AgentAdapter {
  private readonly runs = new Map<string, RunState>();

  constructor(
    private readonly execute: CommandExecutor = runCommand,
    private readonly command = "codex"
  ) {}

  startRun(context: RunContext): Promise<RunHandle> {
    const runId = randomUUID();
    this.runs.set(runId, { context });
    return Promise.resolve({ runId });
  }

  async *streamEvents(runId: string): AsyncIterable<AdapterEvent> {
    const run = this.runs.get(runId);
    if (!run) {
      yield {
        type: "run.failed",
        runId,
        reason: "unknown run",
        at: new Date().toISOString()
      };
      return;
    }

    yield { type: "run.started", runId, at: new Date().toISOString() };

    const args = ["exec", "--json"];
    if (run.context.approvalMode) {
      args.push("--approval-mode", run.context.approvalMode);
    }
    args.push(run.context.prompt);

    const result = await this.execute(
      this.command,
      args,
      run.context.workingDirectory,
      run.context.env ?? {}
    );

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        const externalRunId = extractExternalRunId(parsed);
        if (externalRunId) {
          run.externalRunId = externalRunId;
        }
      } catch {
        // Best effort parse: codex may emit non-JSON lines in mixed streams.
      }

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
      reason: `codex exited with code ${String(result.exitCode)}`,
      at: new Date().toISOString()
    };
  }

  resume(runId: string): Promise<RunHandle> {
    const run = this.runs.get(runId);
    if (!run) {
      return Promise.reject(new Error(`run not found: ${runId}`));
    }

    if (!run.externalRunId) {
      return Promise.reject(new Error(`external run id not found: ${runId}`));
    }

    return Promise.resolve({ runId, externalRunId: run.externalRunId });
  }

  cancel(runId: string): Promise<void> {
    this.runs.delete(runId);
    return Promise.resolve();
  }
}
