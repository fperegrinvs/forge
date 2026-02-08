import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AdapterEvent, AgentAdapter, RunContext, RunHandle } from "@forge/shared-utils";

type HookEvent = { hook_event_name?: string; hookEventName?: string; session_id?: string; sessionId?: string };

class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(value: T) => void> = [];

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(value);
      return;
    }
    this.items.push(value);
  }

  drain(): void {
    this.items.splice(0, this.items.length);
  }

  async shift(): Promise<T> {
    const next = this.items.shift();
    if (next !== undefined) return next;
    return await new Promise<T>((resolve) => this.waiters.push(resolve));
  }
}

function hookEventName(payload: HookEvent): string {
  return payload.hook_event_name ?? payload.hookEventName ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

class ClaudeHookServer {
  private readonly events = new AsyncQueue<HookEvent>();
  private readonly server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/hook") {
      res.statusCode = 404;
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (isRecord(parsed)) {
          this.events.push(parsed as HookEvent);
        }
      } catch {
        // ignore
      }
      res.statusCode = 200;
      res.end("ok");
    });
  });

  private listening: Promise<string> | null = null;

  async url(): Promise<string> {
    if (!this.listening) {
      this.listening = new Promise((resolve) => {
        this.server.listen(0, "127.0.0.1", () => {
          // Don't keep the process alive solely because the hook server is listening.
          this.server.unref();
          const addr = this.server.address();
          if (addr && typeof addr === "object") {
            resolve(`http://127.0.0.1:${String(addr.port)}/hook`);
            return;
          }
          resolve("http://127.0.0.1:0/hook");
        });
      });
    }
    return await this.listening;
  }

  drain(): void {
    this.events.drain();
  }

  async waitForStop(): Promise<HookEvent> {
    for (;;) {
      const ev = await this.events.shift();
      if (hookEventName(ev) === "Stop") return ev;
    }
  }
}

type RunState = {
  context: RunContext;
  externalRunId?: string; // claude session id (best-effort)
};

type TaskSession = {
  child: ChildProcessWithoutNullStreams;
  hookServer: ClaudeHookServer;
  externalRunId?: string;
};

export type ClaudePtyAdapterOptions = {
  command?: string;
  scriptCommand?: string;
  spawnImpl?: typeof spawn;
  createInterfaceImpl?: typeof createInterface;
  writeJsonImpl?: (path: string, value: unknown) => Promise<void>;
  hookServer?: ClaudeHookServer;
};

export class ClaudePtyAdapter implements AgentAdapter {
  private readonly runs = new Map<string, RunState>();
  private readonly sessionsByTask = new Map<string, TaskSession>();
  private readonly hookServer: ClaudeHookServer;
  private readonly spawnImpl: typeof spawn;
  private readonly createInterfaceImpl: typeof createInterface;
  private readonly writeJsonImpl: (path: string, value: unknown) => Promise<void>;
  private readonly scriptCommand: string;
  private readonly command: string;

  constructor(commandOrOptions: string | ClaudePtyAdapterOptions = "claude", maybeOptions: ClaudePtyAdapterOptions = {}) {
    const options = typeof commandOrOptions === "string" ? { ...maybeOptions, command: commandOrOptions } : commandOrOptions;
    this.command = options.command ?? "claude";
    this.scriptCommand = options.scriptCommand ?? "/usr/bin/script";
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.createInterfaceImpl = options.createInterfaceImpl ?? createInterface;
    this.writeJsonImpl = options.writeJsonImpl ?? writeJson;
    this.hookServer = options.hookServer ?? new ClaudeHookServer();
  }

  startRun(context: RunContext): Promise<RunHandle> {
    const runId = randomUUID();
    this.runs.set(runId, { context });
    return Promise.resolve({ runId });
  }

  resume(runId: string): Promise<RunHandle> {
    const run = this.runs.get(runId);
    if (!run) return Promise.reject(new Error(`run not found: ${runId}`));
    if (run.externalRunId) return Promise.resolve({ runId, externalRunId: run.externalRunId });
    return Promise.resolve({ runId });
  }

  cancel(runId: string): Promise<void> {
    this.runs.delete(runId);
    return Promise.resolve();
  }

  async *streamEvents(runId: string): AsyncIterable<AdapterEvent> {
    const run = this.runs.get(runId);
    if (!run) {
      yield { type: "run.failed", runId, reason: "unknown run", at: new Date().toISOString() } as const;
      return;
    }

    yield { type: "run.started", runId, at: new Date().toISOString() } as const;

    const session = await this.ensureSession(run.context);
    // Drain any stale hook events from previous turns in the same interactive session.
    session.hookServer.drain();

    // Stream PTY output to the caller.
    const queue = new AsyncQueue<string>();
    const stdoutRl = this.createInterfaceImpl({ input: session.child.stdout });
    const stderrRl = this.createInterfaceImpl({ input: session.child.stderr });
    stdoutRl.on("line", (line) => {
      queue.push(`${line}\n`);
    });
    stderrRl.on("line", (line) => {
      queue.push(`${line}\n`);
    });

    // Send the prompt as if typed in the interactive terminal.
    session.child.stdin.write(`${run.context.prompt}\n`);

    // Pump output until Stop hook fires, then finish.
    const stopPromise = session.hookServer.waitForStop();
    for (;;) {
      const race = await Promise.race([queue.shift().then((c) => ({ type: "out" as const, c })), stopPromise.then((e) => ({ type: "stop" as const, e }))]);
      if (race.type === "out") {
        yield { type: "run.output", runId, stream: "stdout", chunk: race.c, at: new Date().toISOString() } as const;
        continue;
      }

      // Best-effort capture of the session id for manual resume.
      const external =
        typeof race.e.session_id === "string"
          ? race.e.session_id
          : typeof race.e.sessionId === "string"
            ? race.e.sessionId
            : undefined;
      if (external) {
        run.externalRunId = external;
        session.externalRunId = external;
      }

      yield { type: "run.completed", runId, exitCode: 0, at: new Date().toISOString() } as const;
      return;
    }
  }

  private async ensureSession(context: RunContext): Promise<TaskSession> {
    const existing = this.sessionsByTask.get(context.taskId);
    if (existing) return existing;

    const hookUrl = await this.hookServer.url();
    const settingsPath = join(context.workingDirectory, ".forge", "claude-hooks", `${context.taskId}.settings.json`);
    const hookRunnerPath = fileURLToPath(new URL("./hook-bridge-runner.js", import.meta.url));

    await this.writeJsonImpl(settingsPath, {
      hooks: {
        Stop: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: `node ${JSON.stringify(hookRunnerPath)}` }]
          }
        ],
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: `node ${JSON.stringify(hookRunnerPath)}` }]
          }
        ]
      }
    });

    // Use /usr/bin/script to allocate a PTY-like environment while keeping stdin/out pipeable.
    const child = this.spawnImpl(this.scriptCommand, ["-q", "/dev/null", this.command, "--settings", settingsPath], {
      cwd: context.workingDirectory,
      env: {
        ...process.env,
        FORGE_HOOK_URL: hookUrl
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const session: TaskSession = {
      child,
      hookServer: this.hookServer
    };
    this.sessionsByTask.set(context.taskId, session);
    return session;
  }
}
