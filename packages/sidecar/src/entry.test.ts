import { describe, expect, it } from "vitest";
import { runEntryFromLine } from "./entry.js";
import { SIDECAR_PROTOCOL_VERSION } from "./index.js";

describe("sidecar entry", () => {
  it("parses a start command line and returns exitCode + result", async () => {
    // Given a sidecar start line for plan validation
    const line = JSON.stringify({
      command: "plan.validate",
      params: { planPath: "plans/does-not-exist.plan.json" }
    });

    // When the entry parses and executes it
    const out = await runEntryFromLine(line);

    // Then it returns a structured result and a validation exit code
    expect(out.command).toBe("plan.validate");
    expect(out.exitCode).toBe(2);
    expect(typeof (out.result as any).valid).toBe("boolean");
  });

  it("exports a protocol version constant", () => {
    // Given the sidecar package is imported
    // When reading the protocol version
    // Then it is a stable number
    expect(SIDECAR_PROTOCOL_VERSION).toBeTypeOf("number");
  });

  it("rejects non-JSON input", async () => {
    // Given a non-JSON start line
    const line = "not-json";

    // When the entry executes it
    // Then it throws a structured error
    await expect(runEntryFromLine(line)).rejects.toThrow(/start command must be JSON/);
  });
});
