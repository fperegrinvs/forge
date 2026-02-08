import { describe, expect, it } from "vitest";
import { runSidecarCommand } from "./sidecar.js";

// These are spec tests for the Desktop-only sidecar; they should fail until implemented.

describe("sidecar", () => {
  it("plan.validate returns JSON result (invalid plans should not throw)", async () => {
    // Given a sidecar command to validate a plan
    const cmd = { command: "plan.validate", params: { planPath: "plans/does-not-exist.plan.json" } } as const;

    // When the command is executed
    let result: any;
    try {
      result = await runSidecarCommand(cmd);
    } catch (error) {
      // Then it should return a structured result, not throw
      expect(error).toBeUndefined();
    }

    // Then the result is a JSON object with a validity flag
    expect(result).toBeTypeOf("object");
    expect(typeof result.valid).toBe("boolean");
    expect(Array.isArray(result.issues)).toBe(true);
  });
});
