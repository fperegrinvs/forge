import { describe, expect, it } from "vitest";
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
    const codex = new CodexAdapter(async () => ({
      exitCode: 0,
      stdout: "line\n",
      stderr: ""
    }));

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
