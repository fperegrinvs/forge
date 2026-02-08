import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AdapterEvent, AgentAdapter, RunContext, RunHandle } from "@forge/shared-utils";
import { renderClaudeStreamJsonLine } from "./render.js";

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

const DEFAULT_ALLOWED_TOOLS = ["Bash(git:*)", "Edit", "Read"];

function buildClaudeArgs(context: RunContext): string[] {
  const allowed = context.allowedTools.length > 0 ? context.allowedTools : DEFAULT_ALLOWED_TOOLS;

  // Important: Claude Code expects options before the positional prompt for some shells/parsers.
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ...allowed,
    context.prompt
  ];
}

export class ClaudeAdapter implements AgentAdapter {
  private readonly runs = new Map<string, RunState>();

  constructor(
    private readonly execute?: CommandExecutor,
    private readonly command = "claude"
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

    const args = buildClaudeArgs(run.context);
    if (this.execute) {
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
        const rendered = renderClaudeStreamJsonLine(line);
        if (rendered.parsed) {
          const externalRunId = extractExternalRunId(rendered.parsed);
          if (externalRunId) run.externalRunId = externalRunId;
        }
        if (rendered.tool) {
          yield {
            type: "run.tool",
            runId,
            tool: rendered.tool.name,
            status: rendered.tool.status,
            at: new Date().toISOString()
          };
        }
        yield {
          type: "run.output",
          runId,
          stream: "stdout",
          chunk: rendered.chunk,
          ...(rendered.raw ? { raw: rendered.raw } : {}),
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
      cwd: run.context.workingDirectory,
      env: { ...process.env, ...(run.context.env ?? {}) },
      // Non-interactive: avoid hanging waiting for permissions/input.
      stdio: ["ignore", "pipe", "pipe"]
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

      if (next.stream === "stdout") {
        const rendered = renderClaudeStreamJsonLine(line);
        if (rendered.parsed) {
          const externalRunId = extractExternalRunId(rendered.parsed);
          if (externalRunId) run.externalRunId = externalRunId;
        }
        if (rendered.tool) {
          yield {
            type: "run.tool",
            runId,
            tool: rendered.tool.name,
            status: rendered.tool.status,
            at: new Date().toISOString()
          };
        }
        yield {
          type: "run.output",
          runId,
          stream: "stdout",
          chunk: rendered.chunk,
          ...(rendered.raw ? { raw: rendered.raw } : {}),
          at: new Date().toISOString()
        };
        continue;
      }

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
    const run = this.runs.get(runId);
    if (!run) {
      return Promise.reject(new Error(`run not found: ${runId}`));
    }
    return Promise.resolve({ runId, externalRunId: run.externalRunId });
  }

  cancel(runId: string): Promise<void> {
    this.runs.delete(runId);
    return Promise.resolve();
  }
}
