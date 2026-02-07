import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  // forge-mock: adapter_boundary
  invoke: invokeMock
}));

import { getEvidence, pauseRun, planValidate, resumeRun, runNext } from "./useControlPlane";

describe("useControlPlane", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("calls plan_validate", async () => {
    invokeMock.mockResolvedValue({ valid: true, issues: [] });
    const result = await planValidate("/tmp/plan.json");
    expect(result.valid).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("plan_validate", { filePath: "/tmp/plan.json" });
  });

  it("calls run_next", async () => {
    invokeMock.mockResolvedValue({ state: "completed", message: "done" });
    const result = await runNext("/tmp/plan.json", "codex");
    expect(result.state).toBe("completed");
    expect(invokeMock).toHaveBeenCalledWith("run_next", { planPath: "/tmp/plan.json", adapter: "codex" });
  });

  it("calls pause/resume/get_evidence", async () => {
    invokeMock.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(["x"]);
    expect(await pauseRun("run-1")).toBe(true);
    expect(await resumeRun("run-1")).toBe(true);
    expect(await getEvidence("task-1")).toEqual(["x"]);
  });
});
