import { describe, expect, it } from "vitest";
import { renderCodexJsonLine } from "./render.js";

describe("renderCodexJsonLine", () => {
  it("returns empty chunk for empty input", () => {
    expect(renderCodexJsonLine("")).toEqual({ chunk: "" });
    expect(renderCodexJsonLine("  ")).toEqual({ chunk: "" });
  });

  it("returns non-JSON lines as-is with newline", () => {
    const result = renderCodexJsonLine("plain text output");
    expect(result.chunk).toBe("plain text output\n");
    expect(result.raw).toBe("plain text output");
  });

  it("extracts top-level text field", () => {
    const result = renderCodexJsonLine('{"type":"message","text":"hello world"}');
    expect(result.chunk).toBe("hello world");
    expect(result.parsed).toEqual({ type: "message", text: "hello world" });
  });

  it("extracts text from message.text", () => {
    const result = renderCodexJsonLine('{"message":{"text":"nested msg"}}');
    expect(result.chunk).toBe("nested msg");
  });

  it("extracts text from delta.text", () => {
    const result = renderCodexJsonLine('{"delta":{"text":"delta chunk"}}');
    expect(result.chunk).toBe("delta chunk");
  });

  it("extracts text from content array", () => {
    const input = JSON.stringify({
      content: [
        { type: "text", text: "part1" },
        { type: "image", url: "x" },
        { type: "text", text: "part2" }
      ]
    });
    const result = renderCodexJsonLine(input);
    expect(result.chunk).toBe("part1part2");
  });

  it("falls back to nested text search", () => {
    const input = JSON.stringify({ outer: { inner: { text: "deep value" } } });
    const result = renderCodexJsonLine(input);
    expect(result.chunk).toBe("deep value");
  });

  it("returns empty chunk for JSON with no text", () => {
    const result = renderCodexJsonLine('{"type":"status","code":200}');
    expect(result.chunk).toBe("");
    expect(result.raw).toBe('{"type":"status","code":200}');
    expect(result.parsed).toEqual({ type: "status", code: 200 });
  });

  it("returns empty chunk for non-object JSON", () => {
    const result = renderCodexJsonLine("42");
    expect(result.chunk).toBe("");
    expect(result.raw).toBe("42");
  });
});
