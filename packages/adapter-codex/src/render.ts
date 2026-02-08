export type CodexRendered = {
  chunk: string;
  raw?: string;
  parsed?: unknown;
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

function findNestedText(value: unknown, maxNodes = 200): string | undefined {
  const queue: unknown[] = [value];
  let visited = 0;

  while (queue.length > 0 && visited < maxNodes) {
    visited++;
    const current = queue.shift();
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    if (!isRecord(current)) continue;

    for (const [key, v] of Object.entries(current)) {
      if (key === "text" && typeof v === "string" && v.length > 0) {
        return v;
      }
      if (isRecord(v) || Array.isArray(v)) {
        queue.push(v);
      }
    }
  }

  return undefined;
}

export function renderCodexJsonLine(rawLine: string): CodexRendered {
  const trimmed = rawLine.trim();
  if (!trimmed) return { chunk: "" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    // Codex can emit non-JSON lines in mixed streams.
    return { chunk: `${trimmed}\n`, raw: trimmed };
  }

  if (!isRecord(parsed)) {
    return { chunk: "", raw: trimmed, parsed };
  }

  if (typeof parsed.text === "string" && parsed.text.length > 0) {
    return { chunk: parsed.text, raw: trimmed, parsed };
  }

  const message = parsed.message;
  if (isRecord(message) && typeof message.text === "string" && message.text.length > 0) {
    return { chunk: message.text, raw: trimmed, parsed };
  }

  const delta = parsed.delta;
  if (isRecord(delta) && typeof delta.text === "string" && delta.text.length > 0) {
    return { chunk: delta.text, raw: trimmed, parsed };
  }

  const contentText = extractTextFromContentArray(parsed.content);
  if (contentText) return { chunk: contentText, raw: trimmed, parsed };

  const nestedText = findNestedText(parsed);
  if (nestedText) return { chunk: nestedText, raw: trimmed, parsed };

  return { chunk: "", raw: trimmed, parsed };
}
