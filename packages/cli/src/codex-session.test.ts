import { describe, expect, it, vi } from "vitest";

let startRunCalls = 0;

// forge-mock: failure_simulation
vi.mock("@forge/adapter-codex", () => {
  class CodexAppServerAdapter {
    async startRun() {
      startRunCalls += 1;
      return { runId: `run-${startRunCalls}` };
    }

    async *streamEvents(runId: string) {
      yield { type: "run.started", runId, at: new Date().toISOString() } as const;
      yield { type: "run.output", runId, stream: "stdout", chunk: "ok", at: new Date().toISOString() } as const;
      yield { type: "run.completed", runId, exitCode: 0, at: new Date().toISOString() } as const;
    }
  }

  return { CodexAppServerAdapter };
});

// Feed deterministic input lines to `forge codex session`.
// forge-mock: failure_simulation
vi.mock("node:readline", () => {
  return {
    createInterface: () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield "hello";
          yield JSON.stringify({
            type: "user_input.response",
            requestId: "300",
            answers: { q1: { answers: ["Option A"] } }
          });
          yield "/exit";
        }
      };
    }
  };
});

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as unknown as typeof process.stdout.write;

  try {
    await run();
    return chunks.join("");
  } finally {
    process.stdout.write = original;
  }
}

describe("cli codex session", () => {
  it("streams adapter events and ignores stdin user_input.response lines", async () => {
    // Import after mocks so cli.ts uses them.
    const { buildCli } = await import("./cli.js");

    const stdout = await captureStdout(async () => {
      const cli = buildCli();
      await cli.parseAsync(["node", "forge", "codex", "session"]);
    });

    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    expect(lines.some((l) => JSON.parse(l).type === "codex.session.started")).toBe(true);
    expect(lines.some((l) => JSON.parse(l).type === "adapter.event")).toBe(true);
    expect(lines.some((l) => JSON.parse(l).type === "codex.session.ended")).toBe(true);

    // Only "hello" should trigger a run; the prompt-response JSON line is ignored.
    expect(startRunCalls).toBe(1);
  });
});
