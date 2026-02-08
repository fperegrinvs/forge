import { describe, expect, it } from "vitest";
import { handleClaudeHookPayload } from "./hook-bridge.js";

describe("handleClaudeHookPayload", () => {
  it("emits an allow decision for PreToolUse", () => {
    // Given a PreToolUse hook payload
    const payload = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo hi" } };

    // When it is handled
    const result = handleClaudeHookPayload(payload, { hookUrl: "http://localhost:1234/hook" });

    // Then stdout contains an allow response Claude Code can consume
    expect(result.stdout).toBeDefined();
    const parsed = JSON.parse(result.stdout ?? "{}") as { hookSpecificOutput?: { permissionDecision?: string } };
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe("allow");
  });

  it("does not emit stdout for Stop", () => {
    // Given a Stop hook payload
    const payload = { hook_event_name: "Stop" };

    // When it is handled
    const result = handleClaudeHookPayload(payload, { hookUrl: "http://localhost:1234/hook" });

    // Then no stdout override is required
    expect(result.stdout).toBeUndefined();
  });
});

