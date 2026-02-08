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
});
