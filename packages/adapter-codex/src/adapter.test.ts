import { describe, expect, it } from "vitest";
import { CodexAdapter } from "./adapter.js";
import "./index.js";

describe("CodexAdapter", () => {
  it("emits started output and completed events", async () => {
    const adapter = new CodexAdapter(async () => ({
      exitCode: 0,
      stdout: '{"type":"message","text":"ok"}\n',
      stderr: ""
    }));

    const handle = await adapter.startRun({
      taskId: "task-1",
      prompt: "hello",
      workingDirectory: process.cwd(),
      allowedTools: []
    });

    const events = [];
    for await (const event of adapter.streamEvents(handle.runId)) {
      events.push(event.type);
    }

    expect(events).toContain("run.started");
    expect(events).toContain("run.output");
    expect(events).toContain("run.completed");
  });

  it("captures external run id from json output and exposes it on resume", async () => {
    const adapter = new CodexAdapter(async () => ({
      exitCode: 0,
      stdout: '{"type":"session.started","thread_id":"thread-123"}\n',
      stderr: ""
    }));

    const handle = await adapter.startRun({
      taskId: "task-2",
      prompt: "hello",
      workingDirectory: process.cwd(),
      allowedTools: []
    });

    for await (const _event of adapter.streamEvents(handle.runId)) {
      // drain
    }

    const resumed = await adapter.resume(handle.runId);
    expect(resumed.externalRunId).toBe("thread-123");
  });

  it("passes approval mode to codex exec", async () => {
    let seenArgs: string[] = [];
    const adapter = new CodexAdapter(async (_command, args) => {
      seenArgs = args;
      return {
        exitCode: 0,
        stdout: "{}\n",
        stderr: ""
      };
    });

    const handle = await adapter.startRun({
      taskId: "task-3",
      prompt: "hello",
      workingDirectory: process.cwd(),
      allowedTools: [],
      approvalMode: "suggest"
    });

    for await (const _event of adapter.streamEvents(handle.runId)) {
      // drain
    }

    expect(seenArgs).toEqual(["exec", "--json", "--approval-mode", "suggest", "hello"]);
  });

  it("fails resume when external run id was not observed", async () => {
    const adapter = new CodexAdapter(async () => ({
      exitCode: 0,
      stdout: '{"type":"message","text":"ok"}\n',
      stderr: ""
    }));

    const handle = await adapter.startRun({
      taskId: "task-4",
      prompt: "hello",
      workingDirectory: process.cwd(),
      allowedTools: []
    });

    for await (const _event of adapter.streamEvents(handle.runId)) {
      // drain
    }

    await expect(adapter.resume(handle.runId)).rejects.toThrow("external run id not found");
  });
});
