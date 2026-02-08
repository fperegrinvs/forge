import { describe, expect, it, vi } from "vitest";
import { runHookBridgeRunner } from "./hook-bridge-runner.js";

describe("hook-bridge-runner", () => {
  it("posts hook payload and writes PreToolUse allow response to stdout", async () => {
    // Given a PreToolUse hook payload and an orchestrator hook URL
    const stdout: string[] = [];
    const fetchImpl = vi.fn(async () => ({ ok: true }) as unknown as Response);

    // When the runner executes
    await runHookBridgeRunner({
      readStdin: () => JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s-1" }),
      env: { FORGE_HOOK_URL: "http://example.test/hook" },
      fetchImpl,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: () => {} }
    });

    // Then it posts the payload and emits an allow decision for Claude to consume
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stdout.join("")).toContain("\"permissionDecision\":\"allow\"");
  });

  it("does not throw if posting hook payload fails", async () => {
    // Given a hook payload and a hook URL with a failing transport
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    // When the runner executes
    await runHookBridgeRunner({
      readStdin: () => JSON.stringify({ hookEventName: "Stop" }),
      env: { FORGE_HOOK_URL: "http://example.test/hook" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      stdout: { write: () => {} },
      stderr: { write: () => {} }
    });

    // Then it completes best-effort without throwing
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on invalid JSON input", async () => {
    // Given invalid JSON input (Claude hook runner reads stdin)
    // When the runner executes
    const promise = runHookBridgeRunner({
      readStdin: () => "{not-json",
      env: {},
      fetchImpl: vi.fn() as unknown as typeof fetch,
      stdout: { write: () => {} },
      stderr: { write: () => {} }
    });

    // Then it rejects with a parse error
    await expect(promise).rejects.toBeInstanceOf(Error);
  });
});

