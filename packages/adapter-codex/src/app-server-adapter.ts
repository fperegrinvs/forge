import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createInterface as createPromptInterface } from "node:readline/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AdapterEvent, AgentAdapter, RunContext, RunHandle } from "@forge/shared-utils";

export type CodexAppServerAdapterOptions = {
  spawnCommand?: string;
  spawnArgs?: string[];
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type JsonRpcRequest = { id: number | string; method: string; params?: unknown };
type JsonRpcResponse = { id: number | string; result?: unknown; error?: unknown };
type JsonRpcNotification = { method: string; params?: unknown };

type UserInputAnswers = Record<string, { answers: string[] }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return isRecord(value) && "id" in value && typeof value.method === "string";
}

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

  async shift(): Promise<T> {
    const next = this.items.shift();
    if (next !== undefined) return next;
    return await new Promise<T>((resolve) => this.waiters.push(resolve));
  }
}

class StdinJsonRouter {
  private readonly pending = new Map<string, (payload: unknown) => void>();
  private readonly rl = createInterface({ input: process.stdin });

  constructor() {
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        return;
      }
      if (!isRecord(parsed) || parsed.type !== "user_input.response") return;
      const requestId = typeof parsed.requestId === "string" ? parsed.requestId : typeof parsed.requestId === "number" ? String(parsed.requestId) : "";
      if (!requestId) return;
      const resolver = this.pending.get(requestId);
      if (!resolver) return;
      this.pending.delete(requestId);
      resolver(parsed);
    });
  }

  waitForResponse(requestId: string): Promise<UserInputAnswers> {
    return new Promise((resolve) => {
      this.pending.set(requestId, (payload: unknown) => {
        if (isRecord(payload) && isRecord(payload.answers)) {
          resolve(payload.answers as UserInputAnswers);
          return;
        }
        resolve({});
      });
    });
  }
}

let globalStdinRouter: StdinJsonRouter | null = null;
function stdinRouter(): StdinJsonRouter {
  if (!globalStdinRouter) globalStdinRouter = new StdinJsonRouter();
  return globalStdinRouter;
}

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly notifications = new AsyncQueue<JsonRpcNotification | JsonRpcRequest>();
  private nextId = 1;
  private initialized = false;

  constructor(private readonly options: CodexAppServerAdapterOptions) {}

  async ensureStarted(): Promise<void> {
    if (this.initialized) return;

    if (!this.child) {
      const command = this.options.spawnCommand ?? "codex";
      const args = this.options.spawnArgs ?? ["app-server"];
      this.child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"]
      });

      const stdoutRl = createInterface({ input: this.child.stdout });
      stdoutRl.on("line", (line) => {
        const parsed = safeJsonParse(line.trim());
        if (!parsed || !isRecord(parsed)) return;

        // Response
        if ("id" in parsed && ("result" in parsed || "error" in parsed)) {
          const id = parsed.id as number | string;
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          if ("error" in parsed && parsed.error) {
            pending.reject(new Error(JSON.stringify(parsed.error)));
          } else {
            pending.resolve(parsed.result);
          }
          return;
        }

        // Request or notification
        if (typeof parsed.method === "string") {
          if ("id" in parsed) {
            this.notifications.push(parsed as JsonRpcRequest);
          } else {
            this.notifications.push(parsed as JsonRpcNotification);
          }
        }
      });

      this.child.on("exit", () => {
        for (const [, pending] of this.pending) {
          pending.reject(new Error("codex app-server exited"));
        }
        this.pending.clear();
      });
    }

    // initialize
    const initResult = await this.request("initialize", {
      clientInfo: { name: "forge", version: "0.1.0" },
      capabilities: { experimentalApi: true }
    });
    void initResult;
    this.notify("initialized");
    this.initialized = true;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.child) throw new Error("app-server not started");
    const id = this.nextId++;
    const payload: JsonRpcRequest = { id, method, ...(params !== undefined ? { params } : {}) };
    const line = JSON.stringify(payload);
    this.child.stdin.write(`${line}\n`);
    return await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.child) throw new Error("app-server not started");
    const payload: JsonRpcNotification = { method, ...(params !== undefined ? { params } : {}) };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async nextNotification(): Promise<JsonRpcNotification | JsonRpcRequest> {
    return await this.notifications.shift();
  }

  respond(id: number | string, result: unknown): void {
    if (!this.child) throw new Error("app-server not started");
    const payload: JsonRpcResponse = { id, result };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  kill(): void {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
    this.initialized = false;
  }
}

type RunState = {
  context: RunContext;
  externalRunId?: string; // threadId
};

export class CodexAppServerAdapter implements AgentAdapter {
  private readonly client: CodexAppServerClient;
  private readonly runs = new Map<string, RunState>();
  private readonly threadsByTask = new Map<string, string>();

  constructor(private readonly options: CodexAppServerAdapterOptions = {}) {
    this.client = new CodexAppServerClient(options);
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
    // If we ever implement turn/interrupt, we'd do it here.
    void runId;
    return Promise.resolve();
  }

  async *streamEvents(runId: string): AsyncIterable<AdapterEvent> {
    const run = this.runs.get(runId);
    if (!run) {
      yield { type: "run.failed", runId, reason: "unknown run", at: new Date().toISOString() } as const;
      return;
    }

    yield { type: "run.started", runId, at: new Date().toISOString() } as const;

    await this.client.ensureStarted();

    const threadId = await this.ensureThread(run.context);
    run.externalRunId = threadId;

    const turnResult = await this.client.request("turn/start", {
      threadId,
      cwd: run.context.workingDirectory,
      input: [{ type: "text", text: run.context.prompt }]
    });

    const turnId = extractTurnId(turnResult);
    if (!turnId) {
      yield {
        type: "run.failed",
        runId,
        reason: "codex app-server: missing turn id",
        at: new Date().toISOString()
      } as const;
      return;
    }

    for (;;) {
      const msg = await this.client.nextNotification();

      // Auto-respond to server-initiated requests (approvals / user input).
      if (isJsonRpcRequest(msg)) {
        if (msg.method === "item/tool/requestUserInput") {
          const requestId = String(msg.id);
          const extracted = extractUserInputQuestions(msg.params);
          yield {
            type: "run.user_input.requested",
            runId,
            requestId,
            questions: extracted,
            at: new Date().toISOString()
          } as const;

          const answers = await this.resolveUserInputAnswers(msg.params, requestId);
          this.client.respond(msg.id, { answers });
          continue;
        }

        this.handleServerRequest(msg);
        continue;
      }

      if (!isRecord(msg) || typeof msg.method !== "string" || !isRecord(msg.params)) {
        continue;
      }

      const method = msg.method;
      const params = msg.params;

      if (
        method === "item/agentMessage/delta" &&
        params.threadId === threadId &&
        params.turnId === turnId &&
        typeof params.delta === "string"
      ) {
        yield {
          type: "run.output",
          runId,
          stream: "stdout",
          chunk: params.delta,
          at: new Date().toISOString()
        } as const;
        continue;
      }

      if (method === "turn/completed" && params.threadId === threadId && isRecord(params.turn) && params.turn.id === turnId) {
        const status = params.turn.status;
        if (status === "failed") {
          const reason = isRecord(params.turn.error) && typeof params.turn.error.message === "string" ? params.turn.error.message : "turn failed";
          yield { type: "run.failed", runId, reason, at: new Date().toISOString() } as const;
          return;
        }
        yield { type: "run.completed", runId, exitCode: 0, at: new Date().toISOString() } as const;
        return;
      }
    }
  }

  private async ensureThread(context: RunContext): Promise<string> {
    const existing = this.threadsByTask.get(context.taskId);
    if (existing) return existing;

    const approvalPolicy = context.approvalMode === "full-auto" || context.approvalMode === "auto-edit" ? "never" : "on-request";

    const result = await this.client.request("thread/start", {
      cwd: context.workingDirectory,
      sandbox: "workspace-write",
      approvalPolicy
    });
    const threadId = extractThreadId(result);
    if (!threadId) {
      throw new Error("codex app-server: missing thread id");
    }
    this.threadsByTask.set(context.taskId, threadId);
    return threadId;
  }

  private handleServerRequest(req: JsonRpcRequest): void {
    const method = req.method;

    if (method === "item/commandExecution/requestApproval") {
      this.client.respond(req.id, { decision: "acceptForSession" });
      return;
    }
    if (method === "item/fileChange/requestApproval") {
      this.client.respond(req.id, { decision: "acceptForSession" });
      return;
    }

    // Unknown request: decline by default.
    this.client.respond(req.id, {});
  }

  private async resolveUserInputAnswers(params: unknown, requestId: string): Promise<UserInputAnswers> {
    if (process.stdin.isTTY) {
      return await this.promptUserInputAnswers(params);
    }

    // Desktop/automation: allow an external UI to answer via stdin JSON.
    if (process.env.FORGE_INTERACTIVE === "1") {
      return await stdinRouter().waitForResponse(requestId);
    }

    // Non-interactive: choose the first option (best-effort) so the workflow can continue.
    const answers: Record<string, { answers: string[] }> = {};
    if (isRecord(params) && Array.isArray(params.questions)) {
      for (const q of params.questions) {
        if (!isRecord(q) || typeof q.id !== "string") continue;
        const opts = Array.isArray(q.options) ? q.options : null;
        const first = opts && isRecord(opts[0]) && typeof opts[0].label === "string" ? opts[0].label : "";
        answers[q.id] = { answers: first ? [first] : [] };
      }
    }
    return answers;
  }

  private async promptUserInputAnswers(params: unknown): Promise<UserInputAnswers> {
    const answers: Record<string, { answers: string[] }> = {};

    const rl = createPromptInterface({ input: process.stdin, output: process.stderr });
    try {
      const qs = isRecord(params) && Array.isArray(params.questions) ? params.questions : [];
      for (const q of qs) {
        if (!isRecord(q) || typeof q.id !== "string") continue;
        const questionText =
          typeof q.question === "string"
            ? q.question
            : typeof q.prompt === "string"
              ? q.prompt
              : `Question ${q.id}`;

        process.stderr.write(`\nCodex requests user input: ${questionText}\n`);

        const opts = Array.isArray(q.options) ? q.options : [];
        const labels: string[] = [];
        const isOtherLabels = new Set<string>();
        for (const opt of opts) {
          if (isRecord(opt) && typeof opt.label === "string") {
            labels.push(opt.label);
            if (opt.isOther === true) {
              isOtherLabels.add(opt.label);
            }
          }
        }

        let selected = "";
        if (labels.length > 0) {
          for (let i = 0; i < labels.length; i += 1) {
            process.stderr.write(`  ${String(i + 1)}. ${labels[i] ?? ""}\n`);
          }
          const raw = (await rl.question("> ")).trim();
          const idx = Number.parseInt(raw, 10);
          if (Number.isFinite(idx) && idx >= 1 && idx <= labels.length) {
            selected = labels[idx - 1] ?? "";
          } else if (labels.includes(raw)) {
            selected = raw;
          } else {
            selected = labels[0] ?? "";
          }

          // If the user chose an isOther option, allow free-form input.
          if (selected && isOtherLabels.has(selected)) {
            const free = (await rl.question("Other: ")).trim();
            if (free) {
              selected = free;
            }
          }
        } else {
          selected = (await rl.question("> ")).trim();
        }

        answers[q.id] = { answers: selected ? [selected] : [] };
      }
    } finally {
      rl.close();
    }
    return answers;
  }
}

function extractUserInputQuestions(params: unknown): Array<{
  id: string;
  header?: string;
  question: string;
  options: Array<{ label: string; description?: string; isOther?: boolean }>;
}> {
  const out: Array<{
    id: string;
    header?: string;
    question: string;
    options: Array<{ label: string; description?: string; isOther?: boolean }>;
  }> = [];

  if (!isRecord(params) || !Array.isArray(params.questions)) return out;
  for (const q of params.questions) {
    if (!isRecord(q) || typeof q.id !== "string") continue;
    const question = typeof q.question === "string" ? q.question : typeof q.prompt === "string" ? q.prompt : "";
    const header = typeof q.header === "string" ? q.header : undefined;
    const optsRaw = Array.isArray(q.options) ? q.options : [];
    const options: Array<{ label: string; description?: string; isOther?: boolean }> = [];
    for (const opt of optsRaw) {
      if (!isRecord(opt) || typeof opt.label !== "string") continue;
      options.push({
        label: opt.label,
        ...(typeof opt.description === "string" ? { description: opt.description } : {}),
        ...(opt.isOther === true ? { isOther: true } : {})
      });
    }

    out.push({ id: q.id, question, ...(header ? { header } : {}), options });
  }
  return out;
}

function extractThreadId(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const thread = result.thread;
  if (isRecord(thread) && typeof thread.id === "string") return thread.id;
  return undefined;
}

function extractTurnId(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const turn = result.turn;
  if (isRecord(turn) && typeof turn.id === "string") return turn.id;
  return undefined;
}
