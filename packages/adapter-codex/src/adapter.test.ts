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

    const events: any[] = [];
    for await (const event of adapter.streamEvents(handle.runId)) events.push(event);

    expect(events.map((e) => e.type)).toContain("run.started");
    expect(events.map((e) => e.type)).toContain("run.output");
    expect(events.map((e) => e.type)).toContain("run.completed");

    const output = events.find((e) => e.type === "run.output");
    expect(output?.chunk).toBe("ok");
    expect(output?.raw).toBe('{"type":"message","text":"ok"}');
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

  it("does not pass --full-auto for suggest approval mode", async () => {
    let seenArgs: string[] = [];
    const adapter = new CodexAdapter(async (_command, args) => {
      seenArgs = args;
      return { exitCode: 0, stdout: "{}\n", stderr: "" };
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

    expect(seenArgs).toEqual(["exec", "--json", "hello"]);
  });

  it("maps full-auto approval mode to --full-auto flag", async () => {
    let seenArgs: string[] = [];
    const adapter = new CodexAdapter(async (_command, args) => {
      seenArgs = args;
      return { exitCode: 0, stdout: "{}\n", stderr: "" };
    });

    const handle = await adapter.startRun({
      taskId: "task-3b",
      prompt: "hello",
      workingDirectory: process.cwd(),
      allowedTools: [],
      approvalMode: "full-auto"
    });

    for await (const _event of adapter.streamEvents(handle.runId)) {
      // drain
    }

    expect(seenArgs).toEqual(["exec", "--json", "--full-auto", "hello"]);
  });

  it("emits run.failed for unknown run id", async () => {
    const adapter = new CodexAdapter(async () => ({
      exitCode: 0, stdout: "", stderr: ""
    }));

    const events: any[] = [];
    for await (const event of adapter.streamEvents("nonexistent")) events.push(event);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("run.failed");
    expect(events[0].reason).toBe("unknown run");
  });

  it("emits run.failed when codex exits non-zero", async () => {
    const adapter = new CodexAdapter(async () => ({
      exitCode: 1, stdout: "", stderr: "error output"
    }));

    const handle = await adapter.startRun({
      taskId: "task-fail",
      prompt: "hello",
      workingDirectory: process.cwd(),
      allowedTools: []
    });

    const events: any[] = [];
    for await (const event of adapter.streamEvents(handle.runId)) events.push(event);

    const failed = events.find((e) => e.type === "run.failed");
    expect(failed).toBeDefined();
    expect(failed.reason).toBe("codex exited with code 1");

    const stderr = events.find((e) => e.type === "run.output" && e.stream === "stderr");
    expect(stderr?.chunk).toBe("error output");
  });

  it("rejects resume for unknown run id", async () => {
    const adapter = new CodexAdapter(async () => ({
      exitCode: 0, stdout: "", stderr: ""
    }));
    await expect(adapter.resume("nonexistent")).rejects.toThrow("run not found");
  });

  it("cancels a run", async () => {
    const adapter = new CodexAdapter(async () => ({
      exitCode: 0, stdout: "", stderr: ""
    }));
    const handle = await adapter.startRun({
      taskId: "task-cancel",
      prompt: "hello",
      workingDirectory: process.cwd(),
      allowedTools: []
    });
    await adapter.cancel(handle.runId);
    await expect(adapter.resume(handle.runId)).rejects.toThrow("run not found");
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
