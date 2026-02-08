import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { RunContext } from "@forge/shared-utils";
import { CodexAppServerAdapter } from "./app-server-adapter.js";

describe("CodexAppServerAdapter (stdin router)", () => {
  it("can receive prompt answers from stdin JSON without requiring a TTY", async () => {
    // Given a non-TTY process with FORGE_INTERACTIVE enabled and a writable stdin stream
    const originalEnv = process.env.FORGE_INTERACTIVE;
    const originalStdin = process.stdin;

    const stdin = new PassThrough();
    Object.defineProperty(stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
    process.env.FORGE_INTERACTIVE = "1";

    try {
      const dir = await mkdtemp(join(tmpdir(), "forge-codex-appserver-stdin-"));
      const serverPath = join(dir, "server-stdin.mjs");

      await writeFile(
        serverPath,
        `
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
let initialized = false;
let threadId = "thread-1";
let turnId = "turn-1";

let answered = false;

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }

function maybeComplete() {
  if (!answered) return;
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
    send({
      id: 300,
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          {
            id: "q1",
            question: "Pick one",
            options: [{ label: "Option A" }, { label: "Other", isOther: true }]
          }
        ]
      }
    });
    return;
  }

  if (msg && typeof msg === "object" && typeof msg.id !== "undefined" && typeof msg.method === "undefined") {
    if (msg.id === 300) {
      const ans = msg.result && msg.result.answers && msg.result.answers.q1;
      const value = ans && Array.isArray(ans.answers) ? ans.answers[0] : "";
      answered = value === "Desktop answer";
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

      const handle = await adapter.startRun(context);
      const types: string[] = [];

      // When the server requests user input and the UI responds via stdin JSON
      for await (const event of adapter.streamEvents(handle.runId)) {
        types.push(event.type);
        if (event.type === "run.user_input.requested") {
          stdin.write(
            `${JSON.stringify({
              type: "user_input.response",
              requestId: event.requestId,
              answers: { q1: { answers: ["Desktop answer"] } }
            })}\n`
          );
        }
        if (event.type === "run.failed") throw new Error(event.reason);
      }

      // Then the run completes using the provided answer
      expect(types).toContain("run.user_input.requested");
      expect(types).toContain("run.completed");
    } finally {
      stdin.end();
      Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
      if (originalEnv === undefined) {
        delete process.env.FORGE_INTERACTIVE;
      } else {
        process.env.FORGE_INTERACTIVE = originalEnv;
      }
    }
  });
});
