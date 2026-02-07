import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
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
    private readonly execute?: CommandExecutor,
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
    if (this.execute) {
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
        yield { type: "run.completed", runId, exitCode: 0, at: new Date().toISOString() };
        return;
      }

      yield {
        type: "run.failed",
        runId,
        reason: `claude exited with code ${String(result.exitCode)}`,
        at: new Date().toISOString()
      };
      return;
    }

    const child = spawn(this.command, args, {
      cwd: context.workingDirectory,
      env: { ...process.env, ...(context.env ?? {}) },
      stdio: ["inherit", "pipe", "pipe"]
    });

    const queue: Array<{ stream: "stdout" | "stderr"; line: string }> = [];
    let notify: (() => void) | null = null;
    let closed = false;
    let exitCode: number | null = null;

    const push = (item: { stream: "stdout" | "stderr"; line: string }) => {
      queue.push(item);
      if (notify) {
        const n = notify;
        notify = null;
        n();
      }
    };
    const close = () => {
      closed = true;
      if (notify) {
        const n = notify;
        notify = null;
        n();
      }
    };

    child.on("error", () => {
      exitCode = 1;
      close();
    });
    child.on("close", (code) => {
      exitCode = code ?? 1;
      close();
    });

    const stdoutRl = createInterface({ input: child.stdout });
    const stderrRl = createInterface({ input: child.stderr });

    stdoutRl.on("line", (line) => {
      push({ stream: "stdout", line });
    });
    stderrRl.on("line", (line) => {
      push({ stream: "stderr", line });
    });

    for (;;) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `closed` is updated via child process event handlers.
      if (closed && queue.length === 0) {
        break;
      }
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        continue;
      }

      const next = queue.shift();
      if (!next) continue;
      const line = next.line.trim();
      if (!line) continue;

      yield {
        type: "run.output",
        runId,
        stream: next.stream,
        chunk: line,
        at: new Date().toISOString()
      };
    }

    const finalExitCode: number = typeof exitCode === "number" ? exitCode : 1;
    if (finalExitCode === 0) {
      yield { type: "run.completed", runId, exitCode: 0, at: new Date().toISOString() };
      return;
    }

    yield {
      type: "run.failed",
      runId,
      reason: `claude exited with code ${String(finalExitCode)}`,
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
