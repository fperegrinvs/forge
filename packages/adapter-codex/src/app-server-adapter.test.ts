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
});

