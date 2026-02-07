import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  // forge-mock: adapter_boundary
  invoke: invokeMock
}));

import {
  getEvidence,
  packsCheckUpdates,
  packsDownload,
  packsListInstalled,
  pauseRun,
  planValidate,
  projectGetGuidanceStatus,
  projectInstallGuidance,
  resumeRun,
  runNext
} from "./useControlPlane";

describe("useControlPlane", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("calls plan_validate", async () => {
    // Given the backend returns a valid result
    invokeMock.mockResolvedValue({ valid: true, issues: [] });
    // When plan validation is requested
    const result = await planValidate("/tmp/project", "/tmp/plan.json");
    // Then invoke is called with expected args and the result is returned
    expect(result.valid).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("plan_validate", { projectRoot: "/tmp/project", planPath: "/tmp/plan.json" });
  });

  it("calls run_next", async () => {
    // Given the backend returns a completed run result
    invokeMock.mockResolvedValue({ state: "completed", runId: "run-1", message: "done" });
    // When run next is requested
    const result = await runNext("/tmp/project", "/tmp/plan.json", "codex");
    // Then invoke is called with expected args and the state is returned
    expect(result.state).toBe("completed");
    expect(invokeMock).toHaveBeenCalledWith("run_next", {
      projectRoot: "/tmp/project",
      planPath: "/tmp/plan.json",
      adapter: "codex"
    });
  });

  it("calls packs + guidance endpoints", async () => {
    // Given the backend responds to each call
    invokeMock
      .mockResolvedValueOnce({ installed: false })
      .mockResolvedValueOnce([{ name: "forge-guidance-pack", version: "1.0.0", path: "/packs/x" }])
      .mockResolvedValueOnce([{ name: "forge-guidance-pack", hasUpdate: true, latestVersion: "2.0.0" }])
      .mockResolvedValueOnce({ name: "forge-guidance-pack", version: "2.0.0", path: "/packs/y" })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce(["/evidence/1"]);

    // When project and pack operations are requested
    await projectGetGuidanceStatus("/tmp/project");
    await packsListInstalled();
    await packsCheckUpdates();
    await packsDownload("forge-guidance-pack");
    await projectInstallGuidance("/tmp/project", "/packs/y", false);
    const evidence = await getEvidence("/tmp/project", "task-1");

    // Then the expected invoke calls occur
    expect(invokeMock).toHaveBeenCalledWith("project_get_guidance_status", { projectRoot: "/tmp/project" });
    expect(invokeMock).toHaveBeenCalledWith("packs_list_installed");
    expect(invokeMock).toHaveBeenCalledWith("packs_check_updates");
    expect(invokeMock).toHaveBeenCalledWith("packs_download", { packName: "forge-guidance-pack", version: undefined });
    expect(invokeMock).toHaveBeenCalledWith("project_install_guidance", {
      projectRoot: "/tmp/project",
      packPath: "/packs/y",
      forceReplace: false
    });
    expect(evidence).toEqual(["/evidence/1"]);
  });

  it("calls pause and resume", async () => {
    // Given pause and resume succeed
    invokeMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ state: "completed", runId: "run-1", message: "ok" });

    // When pause and resume are requested
    expect(await pauseRun("run-1")).toBe(true);
    const resumed = await resumeRun("/tmp/project", "/tmp/plan.json", "run-1", "codex");

    // Then resume returns a run result
    expect(resumed.state).toBe("completed");
  });
});
