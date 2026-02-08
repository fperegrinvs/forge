import { describe, expect, it } from "vitest";
import { CodexAdapter } from "./index.js";

describe("@forge/adapter-codex index", () => {
  it("exports CodexAdapter (app-server transport)", () => {
    const adapter = new CodexAdapter();
    expect(adapter).toBeInstanceOf(CodexAdapter);
  });
});

