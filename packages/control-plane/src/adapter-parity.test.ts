import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter } from "@forge/adapter-codex";
import { ClaudeAdapter } from "@forge/adapter-claude";
import type { AgentAdapter, RunContext } from "@forge/shared-utils";

async function collectTypes(adapter: AgentAdapter) {
  const context: RunContext = {
    taskId: "task-1",
    prompt: "hello",
    workingDirectory: process.cwd(),
    allowedTools: []
  };
  const handle = await adapter.startRun({
    ...context
  });

  const types: string[] = [];
  for await (const event of adapter.streamEvents(handle.runId)) {
    types.push(event.type);
  }
  return types;
}

describe("adapter parity", () => {
  it("codex and claude adapters emit compatible event sequence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-codex-parity-"));
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
    send({ method: "item/agentMessage/delta", params: { delta: "line", itemId: "item-1", threadId, turnId } });
    send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
    return;
  }
});
      `.trim(),
      "utf8"
    );

    const codex = new CodexAdapter({
      spawnCommand: "node",
      spawnArgs: [serverPath]
    });

    const claude = new ClaudeAdapter(async () => ({
      exitCode: 0,
      stdout: "line\n",
      stderr: ""
    }));

    const codexEvents = await collectTypes(codex);
    const claudeEvents = await collectTypes(claude);

    expect(codexEvents).toEqual(["run.started", "run.output", "run.completed"]);
    expect(claudeEvents).toEqual(["run.started", "run.output", "run.completed"]);
  });
});
