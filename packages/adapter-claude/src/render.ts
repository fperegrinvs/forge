type ToolStatus = "started" | "completed" | "failed";

export type ClaudeRendered = {
  chunk: string;
  raw?: string;
  parsed?: unknown;
  tool?: { name: string; status: ToolStatus };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractTextFromContentArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && typeof item.text === "string" && item.text.length > 0) {
      parts.push(item.text);
    }
  }
  if (parts.length === 0) return undefined;
  return parts.join("");
}

export function renderClaudeStreamJsonLine(rawLine: string): ClaudeRendered {
  const trimmed = rawLine.trim();
  if (!trimmed) return { chunk: "" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    // Claude can emit non-JSON lines (or mixed streams). Surface them as-is.
    return { chunk: `${trimmed}\n` };
  }

  if (!isRecord(parsed)) {
    return { chunk: "", raw: trimmed, parsed };
  }

  const type = typeof parsed.type === "string" ? parsed.type : "";

  // Tool start (Anthropic streaming format commonly uses content_block_start/tool_use).
  if (type === "content_block_start") {
    const block = parsed.content_block;
    if (isRecord(block) && block.type === "tool_use") {
      const name = typeof block.name === "string" && block.name.trim() ? block.name.trim() : "tool";
      return { chunk: "", raw: trimmed, parsed, tool: { name, status: "started" } };
    }
    return { chunk: "", raw: trimmed, parsed };
  }

  // Errors: surface a readable line.
  if (type === "error") {
    const err = parsed.error;
    if (isRecord(err)) {
      const message = typeof err.message === "string" ? err.message : "";
      if (message.trim()) {
        return { chunk: `[error] ${message.trim()}\n`, raw: trimmed, parsed };
      }
    }
    return { chunk: "[error]\n", raw: trimmed, parsed };
  }

  // Primary text sources.
  if (typeof parsed.text === "string" && parsed.text.length > 0) {
    return { chunk: parsed.text, raw: trimmed, parsed };
  }

  const delta = parsed.delta;
  if (isRecord(delta) && typeof delta.text === "string" && delta.text.length > 0) {
    return { chunk: delta.text, raw: trimmed, parsed };
  }

  const block = parsed.content_block;
  if (isRecord(block) && typeof block.text === "string" && block.text.length > 0) {
    return { chunk: block.text, raw: trimmed, parsed };
  }
  if (isRecord(block) && isRecord(block.delta) && typeof block.delta.text === "string" && block.delta.text.length > 0) {
    return { chunk: block.delta.text, raw: trimmed, parsed };
  }

  if (isRecord(parsed.message)) {
    const message = parsed.message;
    const contentText = extractTextFromContentArray(message.content);
    if (contentText) return { chunk: contentText, raw: trimmed, parsed };
  }

  const contentText = extractTextFromContentArray(parsed.content);
  if (contentText) return { chunk: contentText, raw: trimmed, parsed };

  // Preserve raw for evidence/debugging, but avoid spamming the UI.
  return { chunk: "", raw: trimmed, parsed };
}
