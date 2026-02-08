import { describe, expect, it } from "vitest";
import { renderClaudeStreamJsonLine } from "./render.js";

describe("renderClaudeStreamJsonLine", () => {
  it("returns empty chunk for empty input", () => {
    expect(renderClaudeStreamJsonLine("")).toEqual({ chunk: "" });
    expect(renderClaudeStreamJsonLine("  ")).toEqual({ chunk: "" });
  });

  it("returns non-JSON lines as-is with newline", () => {
    const result = renderClaudeStreamJsonLine("plain text");
    expect(result.chunk).toBe("plain text\n");
  });

  it("returns empty chunk for non-object JSON", () => {
    const result = renderClaudeStreamJsonLine("42");
    expect(result.chunk).toBe("");
    expect(result.raw).toBe("42");
  });

  it("extracts top-level text field", () => {
    const result = renderClaudeStreamJsonLine('{"type":"assistant","text":"hello"}');
    expect(result.chunk).toBe("hello");
    expect(result.raw).toBe('{"type":"assistant","text":"hello"}');
  });

  it("extracts delta.text", () => {
    const result = renderClaudeStreamJsonLine('{"delta":{"text":"streaming"}}');
    expect(result.chunk).toBe("streaming");
  });

  it("extracts content_block.text", () => {
    const result = renderClaudeStreamJsonLine('{"content_block":{"text":"block text"}}');
    expect(result.chunk).toBe("block text");
  });

  it("extracts content_block.delta.text", () => {
    const input = JSON.stringify({ content_block: { delta: { text: "delta text" } } });
    const result = renderClaudeStreamJsonLine(input);
    expect(result.chunk).toBe("delta text");
  });

  it("detects tool_use in content_block_start", () => {
    const input = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "bash" }
    });
    const result = renderClaudeStreamJsonLine(input);
    expect(result.tool).toEqual({ name: "bash", status: "started" });
    expect(result.chunk).toBe("");
  });

  it("handles content_block_start without tool_use", () => {
    const input = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "text", text: "" }
    });
    const result = renderClaudeStreamJsonLine(input);
    expect(result.tool).toBeUndefined();
    expect(result.chunk).toBe("");
  });

  it("renders error with message", () => {
    const input = JSON.stringify({
      type: "error",
      error: { message: "rate limited" }
    });
    const result = renderClaudeStreamJsonLine(input);
    expect(result.chunk).toBe("[error] rate limited\n");
  });

  it("renders error without message", () => {
    const input = JSON.stringify({ type: "error", error: {} });
    const result = renderClaudeStreamJsonLine(input);
    expect(result.chunk).toBe("[error]\n");
  });

  it("extracts text from message.content array", () => {
    const input = JSON.stringify({
      message: {
        content: [
          { type: "text", text: "part1" },
          { type: "text", text: "part2" }
        ]
      }
    });
    const result = renderClaudeStreamJsonLine(input);
    expect(result.chunk).toBe("part1part2");
  });

  it("extracts text from top-level content array", () => {
    const input = JSON.stringify({
      content: [{ type: "text", text: "top content" }]
    });
    const result = renderClaudeStreamJsonLine(input);
    expect(result.chunk).toBe("top content");
  });

  it("returns empty chunk for unrecognized JSON", () => {
    const result = renderClaudeStreamJsonLine('{"type":"ping"}');
    expect(result.chunk).toBe("");
    expect(result.raw).toBe('{"type":"ping"}');
  });
});
