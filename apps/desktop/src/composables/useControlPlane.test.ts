import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn()
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
