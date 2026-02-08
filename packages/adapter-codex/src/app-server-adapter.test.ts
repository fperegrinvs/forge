import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunContext } from "@forge/shared-utils";
import { CodexAppServerAdapter } from "./app-server-adapter.js";

describe("CodexAppServerAdapter", () => {
  it("initializes, starts a thread, streams deltas, and completes on turn/completed", async () => {
    // Given a fake app-server that speaks the JSONL protocol
    const dir = await mkdtemp(join(tmpdir(), "forge-codex-appserver-fake-"));
    const serverPath = join(dir, "server.mjs");
    await writeFile(
      serverPath,
      `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
let initialized = false;
let threadId = "thread-1";
let turnId = "turn-1";

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    send({ id: msg.id, result: { userAgent: "fake" } });
    return;
  }
  if (msg.method === "initialized") {
    initialized = true;
    return;
  }
  if (!initialized) {
    send({ id: msg.id, error: { message: "not initialized" } });
    return;
  }
  if (msg.method === "thread/start") {
    send({ id: msg.id, result: { thread: { id: threadId } } });
    return;
  }
  if (msg.method === "turn/start") {
    send({ id: msg.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
    send({ method: "item/agentMessage/delta", params: { delta: "hello", itemId: "item-1", threadId, turnId } });
    send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
    return;
  }
});
      `.trim(),
      "utf8"
    );

    const adapter = new CodexAppServerAdapter({
      spawnCommand: "node",
      spawnArgs: [serverPath]
    });

    const context: RunContext = {
      taskId: "task-1",
      prompt: "do the thing",
      workingDirectory: dir,
      allowedTools: [],
      approvalMode: "full-auto"
    };

    // When a run is started and streamed
    const handle = await adapter.startRun(context);
    const chunks: string[] = [];
    for await (const event of adapter.streamEvents(handle.runId)) {
      if (event.type === "run.output") chunks.push(event.chunk);
      if (event.type === "run.failed") throw new Error(event.reason);
    }

    // Then it streamed assistant deltas and completed
    expect(chunks.join("")).toContain("hello");
  });

  it("auto-responds to approval and requestUserInput server requests", async () => {
    // Given a fake app-server that emits request messages during a turn
    const dir = await mkdtemp(join(tmpdir(), "forge-codex-appserver-fake-"));
    const serverPath = join(dir, "server-requests.mjs");
    await writeFile(
      serverPath,
      `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
let initialized = false;
let threadId = "thread-1";
let turnId = "turn-1";

let approved = false;
let fileApproved = false;
let answered = false;

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }

function maybeComplete() {
  if (!approved || !fileApproved || !answered) return;
  send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
  process.exit(0);
}

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    send({ id: msg.id, result: { userAgent: "fake" } });
    return;
  }
  if (msg.method === "initialized") {
    initialized = true;
    return;
  }
  if (!initialized) {
    send({ id: msg.id, error: { message: "not initialized" } });
    return;
  }
  if (msg.method === "thread/start") {
    send({ id: msg.id, result: { thread: { id: threadId } } });
    return;
  }
  if (msg.method === "turn/start") {
    send({ id: msg.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
    // Server-initiated requests the client must answer.
    send({ id: 200, method: "item/commandExecution/requestApproval", params: { threadId, turnId } });
    send({ id: 202, method: "item/fileChange/requestApproval", params: { threadId, turnId } });
    send({
      id: 201,
      method: "item/tool/requestUserInput",
      params: {
        questions: [{ id: "q1", options: [{ label: "Option A" }, { label: "Option B" }] }]
      }
    });
    return;
  }

  // JSON-RPC responses from the client.
  if (msg && typeof msg === "object" && typeof msg.id !== "undefined" && typeof msg.method === "undefined") {
    if (msg.id === 200) {
      approved = msg.result && msg.result.decision === "acceptForSession";
      maybeComplete();
      return;
    }
    if (msg.id === 202) {
      fileApproved = msg.result && msg.result.decision === "acceptForSession";
      maybeComplete();
      return;
    }
    if (msg.id === 201) {
      const ans = msg.result && msg.result.answers && msg.result.answers.q1;
      answered = ans && Array.isArray(ans.answers) && ans.answers[0] === "Option A";
      maybeComplete();
      return;
    }
  }
});
      `.trim(),
      "utf8"
    );

    const adapter = new CodexAppServerAdapter({
      spawnCommand: "node",
      spawnArgs: [serverPath]
    });

    const context: RunContext = {
      taskId: "task-1",
      prompt: "do the thing",
      workingDirectory: dir,
      allowedTools: [],
      approvalMode: "full-auto"
    };

    // When a run is started and streamed
    const handle = await adapter.startRun(context);
    const types: string[] = [];
    for await (const event of adapter.streamEvents(handle.runId)) {
      types.push(event.type);
      if (event.type === "run.failed") throw new Error(event.reason);
    }

    // Then it completes successfully after auto-answering server requests
    expect(types).toContain("run.completed");
  });
});
