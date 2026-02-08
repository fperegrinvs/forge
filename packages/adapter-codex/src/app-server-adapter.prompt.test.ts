import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunContext } from "@forge/shared-utils";

// Force the TTY prompt path and simulate user answers deterministically.
// forge-mock: adapter_boundary
vi.mock("node:readline/promises", () => {
  return {
    createInterface: () => {
      let calls = 0;
      return {
        question: async () => {
          calls += 1;
          if (calls === 1) return "2"; // choose the "Other" option (2nd option)
          if (calls === 2) return "Custom answer"; // free-form input for isOther
          return "";
        },
        close: () => {}
      };
    }
  };
});

import { CodexAppServerAdapter } from "./app-server-adapter.js";

describe("CodexAppServerAdapter (prompt path)", () => {
  it("uses the isOther option to collect free-form input when stdin is a TTY", async () => {
    const originalIsTTY = process.stdin.isTTY;
    try {
      // Vitest runs non-interactively; force the prompt path.
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

      const dir = await mkdtemp(join(tmpdir(), "forge-codex-appserver-prompt-"));
      const serverPath = join(dir, "server-prompt.mjs");

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
      answered = value === "Custom answer";
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
      for await (const event of adapter.streamEvents(handle.runId)) {
        types.push(event.type);
        if (event.type === "run.failed") throw new Error(event.reason);
      }

      expect(types).toContain("run.user_input.requested");
      expect(types).toContain("run.completed");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });
});
