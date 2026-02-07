import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn()
}));

import {
  getEvidence,
  listTemplates,
  packsCheckUpdates,
  packsDownload,
  packsListInstalled,
  pauseRun,
  planValidate,
  plansList,
  plansStatus,
  projectGetGuidanceStatus,
  projectInit,
  projectInstallGuidance,
  resumeRun,
  runNext,
  selectFolder
} from "./useControlPlane";

describe("useControlPlane", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // URL() uses window.location in the composable.
    vi.stubGlobal("window", { location: { origin: "http://localhost:1420" } });
  });

  it("calls plan_validate", async () => {
    // Given the backend returns a valid result
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, issues: [] })
    });
    // When plan validation is requested
    const result = await planValidate("/tmp/project", "/tmp/plan.json");
    // Then the API is called with expected args and the result is returned
    expect(result.valid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/plan/validate");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ projectRoot: "/tmp/project", planPath: "/tmp/plan.json" }));
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init!.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("calls run_next", async () => {
    // Given the backend returns a completed run result
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ state: "completed", runId: "run-1", message: "done" })
    });
    // When run next is requested
    const result = await runNext("/tmp/project", "/tmp/plan.json", "codex");
    // Then the API is called with expected args and the state is returned
    expect(result.state).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/run/next");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ projectRoot: "/tmp/project", planPath: "/tmp/plan.json", adapter: "codex" }));
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init!.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("calls packs + guidance endpoints", async () => {
    // Given the backend responds to each call
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ installed: false }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: "forge-guidance-pack", version: "1.0.0", path: "/packs/x" }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: "forge-guidance-pack", hasUpdate: true, latestVersion: "2.0.0" }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: "forge-guidance-pack", version: "2.0.0", path: "/packs/y" })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ["/evidence/1"] });

    // When project and pack operations are requested
    await projectGetGuidanceStatus("/tmp/project");
    await packsListInstalled();
    await packsCheckUpdates();
    await packsDownload("forge-guidance-pack");
    await projectInstallGuidance("/tmp/project", "/packs/y", false);
    const evidence = await getEvidence("/tmp/project", "task-1");

    // Then the expected API calls occur
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const [u1, i1] = fetchMock.mock.calls[0]!;
    expect(u1).toBe("http://localhost:1420/api/project/guidance-status?projectRoot=%2Ftmp%2Fproject");
    expect(i1?.method).toBe("GET");

    const [u2, i2] = fetchMock.mock.calls[1]!;
    expect(u2).toBe("/api/packs/installed");
    expect(i2?.method).toBe("GET");

    const [u3, i3] = fetchMock.mock.calls[2]!;
    expect(u3).toBe("/api/packs/updates");
    expect(i3?.method).toBe("GET");

    const [u4, i4] = fetchMock.mock.calls[3]!;
    expect(u4).toBe("/api/packs/download");
    expect(i4?.method).toBe("POST");
    expect(i4?.body).toBe(JSON.stringify({ packName: "forge-guidance-pack", version: undefined }));

    const [u5, i5] = fetchMock.mock.calls[4]!;
    expect(u5).toBe("/api/project/install-guidance");
    expect(i5?.method).toBe("POST");
    expect(i5?.body).toBe(JSON.stringify({ projectRoot: "/tmp/project", packPath: "/packs/y", forceReplace: false }));

    const [u6, i6] = fetchMock.mock.calls[5]!;
    expect(u6).toBe("http://localhost:1420/api/evidence?projectRoot=%2Ftmp%2Fproject&taskId=task-1");
    expect(i6?.method).toBe("GET");

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toBeInstanceOf(Headers);
      expect((init!.headers as Headers).get("content-type")).toBe("application/json");
    }
    expect(evidence).toEqual(["/evidence/1"]);
  });

  it("listTemplates fetches GET /api/templates and returns template array", async () => {
    // Given the backend returns a templates list
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ id: "forge-template", name: "Forge Template", description: "Default project template" }]
    });
    // When listTemplates is called
    const result = await listTemplates();
    // Then it calls GET /api/templates and returns the template array
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/templates");
    expect(init?.method).toBe("GET");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("forge-template");
  });

  it("projectInit sends POST /api/project/init with correct body", async () => {
    // Given the backend returns success
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, projectRoot: "/tmp/my-project" })
    });
    // When projectInit is called with required fields
    const result = await projectInit({ parentDir: "/tmp", projectName: "my-project", template: "forge-template" });
    // Then POST /api/project/init is called with the correct body
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/project/init");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init!.body as string);
    expect(body.parentDir).toBe("/tmp");
    expect(body.projectName).toBe("my-project");
    expect(body.template).toBe("forge-template");
    expect(result.success).toBe(true);
  });

  it("selectFolder fetches GET /api/dialog/select-folder and returns path or null", async () => {
    // Given the backend returns a selected folder path
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ path: "/Users/me/projects" })
    });
    // When selectFolder is called
    const result = await selectFolder();
    // Then it calls GET /api/dialog/select-folder and returns the path
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/dialog/select-folder");
    expect(init?.method).toBe("GET");
    expect(result).toBe("/Users/me/projects");
  });

  it("selectFolder returns null when user cancels", async () => {
    // Given the backend returns null path (user cancelled)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ path: null })
    });
    // When selectFolder is called
    const result = await selectFolder();
    // Then it returns null
    expect(result).toBeNull();
  });

  it("plansList calls GET /api/plans/list and returns PlanFileEntry[]", async () => {
    // Given the backend returns a list of plan files
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { filename: "add-auth.json", path: "/project/plans/add-auth.json" },
        { filename: "fix-bug.json", path: "/project/plans/fix-bug.json" }
      ]
    });
    // When plansList is called
    const result = await plansList("/project");
    // Then it calls GET /api/plans/list with projectRoot query param and returns entries
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:1420/api/plans/list?projectRoot=%2Fproject");
    expect(init?.method).toBe("GET");
    expect(result).toHaveLength(2);
    expect(result[0]!.filename).toBe("add-auth.json");
    expect(result[1]!.path).toBe("/project/plans/fix-bug.json");
  });

  it("plansStatus calls GET /api/plans/status and returns PlanStatusResult", async () => {
    // Given the backend returns task statuses
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [
          { id: "task-1", state: "completed" },
          { id: "task-2", state: "pending" }
        ]
      })
    });
    // When plansStatus is called
    const result = await plansStatus("/project", "plans/add-auth.json");
    // Then it calls GET /api/plans/status with projectRoot and planPath query params
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:1420/api/plans/status?projectRoot=%2Fproject&planPath=plans%2Fadd-auth.json");
    expect(init?.method).toBe("GET");
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]!.id).toBe("task-1");
    expect(result.tasks[0]!.state).toBe("completed");
  });

  it("calls pause and resume", async () => {
    // Given pause and resume succeed
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: "completed", runId: "run-1", message: "ok" }) });

    // When pause and resume are requested
    expect(await pauseRun("run-1")).toBe(true);
    const resumed = await resumeRun("/tmp/project", "/tmp/plan.json", "run-1", "codex");

    // Then resume returns a run result
    expect(resumed.state).toBe("completed");
  });
});
