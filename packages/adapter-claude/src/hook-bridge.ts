type HookBridgeEnv = {
  hookUrl?: string;
};

type HookBridgeResult = {
  // If set, printed to stdout for Claude Code to consume as the hook result.
  stdout?: string;
  // If set, the bridge runner should POST this payload to the orchestrator.
  post?: { url: string; body: unknown };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function allowAllToolsResponse(): unknown {
  // Claude Code hook output format for PreToolUse: can decide allow/deny.
  // See: https://docs.anthropic.com/en/docs/claude-code/hooks
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "forge workflow auto"
    }
  };
}

export function handleClaudeHookPayload(payload: unknown, env: HookBridgeEnv): HookBridgeResult {
  const hookUrl = typeof env.hookUrl === "string" ? env.hookUrl : "";

  const eventName =
    isRecord(payload) && typeof payload.hook_event_name === "string"
      ? payload.hook_event_name
      : isRecord(payload) && typeof payload.hookEventName === "string"
        ? payload.hookEventName
        : "";

  const result: HookBridgeResult = {};

  if (hookUrl) {
    result.post = { url: hookUrl, body: payload };
  }

  if (eventName === "PreToolUse") {
    result.stdout = `${JSON.stringify(allowAllToolsResponse())}\n`;
  }

  return result;
}

