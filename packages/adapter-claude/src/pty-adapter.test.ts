import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { RunContext } from "@forge/shared-utils";
import { ClaudePtyAdapter } from "./pty-adapter.js";

function makeFakeChild(): any {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

describe("ClaudePtyAdapter", () => {
  it("streams output and completes on Stop hook, capturing external session id", async () => {
    // Given an adapter with a fake PTY child process
    const dir = await mkdtemp(join(tmpdir(), "forge-claude-pty-fake-"));

    const child = makeFakeChild();
    let hookUrl: string | null = null;

    const adapter = new ClaudePtyAdapter({
      spawnImpl: (_cmd, _args, options: any) => {
        hookUrl = String(options.env.FORGE_HOOK_URL);
        return child;
      }
    });

    const context: RunContext = {
      taskId: "task-1",
      prompt: "do the thing",
      workingDirectory: dir,
      allowedTools: [],
      approvalMode: "full-auto"
    };

    const handle = await adapter.startRun(context);

    // When a run is started and streamed
    const events: string[] = [];
    const consume = (async () => {
      for await (const ev of adapter.streamEvents(handle.runId)) {
        events.push(ev.type);
      }
    })();

    // Then it exposes a hook URL for hook callbacks
    for (let i = 0; i < 50 && !hookUrl; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(hookUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);

    // And the hook server handles non-hook requests
    const notFound = await fetch(hookUrl!, { method: "GET" });
    expect(notFound.status).toBe(404);

    // And invalid hook payloads are ignored (best-effort)
    const invalid = await fetch(hookUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    expect(invalid.status).toBe(200);

    // And it streams PTY output lines while waiting for Stop
    child.stdout.write("hello\n");
    child.stderr.write("warn\n");

    // When the Stop hook fires (camelCase keys)
    await fetch(hookUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hookEventName: "Stop", sessionId: "session-123" })
    });

    await consume;

    // Then it completed successfully
    expect(events).toContain("run.started");
    expect(events).toContain("run.output");
    expect(events).toContain("run.completed");

    // And the adapter can surface a resumable external id (best-effort)
    const resumed = await adapter.resume(handle.runId);
    expect(resumed.externalRunId).toBe("session-123");
  });

  it("reuses an interactive session per taskId", async () => {
    // Given an adapter and a context that reuses the same taskId
    const dir = await mkdtemp(join(tmpdir(), "forge-claude-pty-reuse-"));
    const child = makeFakeChild();
    let hookUrl: string | null = null;
    let spawnCount = 0;

    const adapter = new ClaudePtyAdapter({
      spawnImpl: (_cmd, _args, options: any) => {
        spawnCount++;
        hookUrl = String(options.env.FORGE_HOOK_URL);
        return child;
      }
    });

    const context: RunContext = {
      taskId: "task-1",
      prompt: "phase 1",
      workingDirectory: dir,
      allowedTools: [],
      approvalMode: "full-auto"
    };

    // When streaming two runs for the same task
    const handle1 = await adapter.startRun(context);
    const p1 = (async () => {
      for await (const _ev of adapter.streamEvents(handle1.runId)) {
        // drain
      }
    })();

    for (let i = 0; i < 50 && !hookUrl; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await fetch(hookUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hook_event_name: "Stop" })
    });
    await p1;

    const handle2 = await adapter.startRun({ ...context, prompt: "phase 2" });
    const p2 = (async () => {
      for await (const _ev of adapter.streamEvents(handle2.runId)) {
        // drain
      }
    })();
    await fetch(hookUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hook_event_name: "Stop" })
    });
    await p2;

    // Then only one PTY session was spawned
    expect(spawnCount).toBe(1);
  });

  it("fails a run if the run id is unknown", async () => {
    // Given an adapter with no such run
    const adapter = new ClaudePtyAdapter({ spawnImpl: () => makeFakeChild() });

    // When streaming events for an unknown run
    const types: string[] = [];
    for await (const ev of adapter.streamEvents("missing")) {
      types.push(ev.type);
    }

    // Then it emits a failed run
    expect(types).toContain("run.failed");
  });
});

