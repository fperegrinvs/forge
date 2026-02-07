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

    const events = [];
    for await (const event of adapter.streamEvents(handle.runId)) {
      events.push(event.type);
    }

    expect(events).toContain("run.started");
    expect(events).toContain("run.output");
    expect(events).toContain("run.completed");
  });
});
