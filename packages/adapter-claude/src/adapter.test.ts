import { describe, expect, it } from "vitest";
import { ClaudeAdapter } from "./adapter.js";
import "./index.js";

describe("ClaudeAdapter", () => {
  it("emits started output and completed events", async () => {
    const adapter = new ClaudeAdapter(async () => ({
      exitCode: 0,
      stdout: '{"type":"assistant","text":"ok"}\n',
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
    expect(output?.raw).toBe('{"type":"assistant","text":"ok"}');
  });

  it("emits run.failed for unknown run id", async () => {
    const adapter = new ClaudeAdapter(async () => ({
      exitCode: 0, stdout: "", stderr: ""
    }));

    const events: any[] = [];
    for await (const event of adapter.streamEvents("nonexistent")) events.push(event);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("run.failed");
    expect(events[0].reason).toBe("unknown run");
  });

  it("emits run.failed when claude exits non-zero", async () => {
    const adapter = new ClaudeAdapter(async () => ({
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
    expect(failed.reason).toBe("claude exited with code 1");

    const stderr = events.find((e) => e.type === "run.output" && e.stream === "stderr");
    expect(stderr?.chunk).toBe("error output");
  });

  it("emits tool events for content_block_start with tool_use", async () => {
    const input = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "bash" }
    });
    const adapter = new ClaudeAdapter(async () => ({
      exitCode: 0, stdout: `${input}\n`, stderr: ""
    }));

    const handle = await adapter.startRun({
      taskId: "task-tool",
      prompt: "hello",
      workingDirectory: process.cwd(),
      allowedTools: []
    });

    const events: any[] = [];
    for await (const event of adapter.streamEvents(handle.runId)) events.push(event);

    const toolEvent = events.find((e) => e.type === "run.tool");
    expect(toolEvent).toBeDefined();
    expect(toolEvent.tool).toBe("bash");
    expect(toolEvent.status).toBe("started");
  });

  it("rejects resume for unknown run id", async () => {
    const adapter = new ClaudeAdapter(async () => ({
      exitCode: 0, stdout: "", stderr: ""
    }));
    await expect(adapter.resume("nonexistent")).rejects.toThrow("run not found");
  });

  it("cancels a run", async () => {
    const adapter = new ClaudeAdapter(async () => ({
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
});
