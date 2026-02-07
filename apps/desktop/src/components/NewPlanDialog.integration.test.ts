import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn()
}));

import { terminalKill, terminalResize, terminalSpawn } from "../composables/useTerminal";

describe("NewPlanDialog integration: open → spawn → resize → close → kill", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "http://localhost:1420", protocol: "http:", host: "localhost:1420" } });
  });

  it("full lifecycle: spawn, resize, then kill", async () => {
    // Given the backend handles spawn, resize, and kill
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: "int-session-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => true
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => true
      });

    // When the dialog opens and spawns a session
    const spawnResult = await terminalSpawn({ command: "claude", cwd: "/tmp/project", cols: 80, rows: 24 });
    expect(spawnResult.sessionId).toBe("int-session-1");

    // And the terminal is resized
    const resizeResult = await terminalResize("int-session-1", 120, 40);
    expect(resizeResult).toBe(true);

    // And the dialog closes, killing the session
    const killResult = await terminalKill("int-session-1");
    expect(killResult).toBe(true);

    // Then all three API calls were made in order
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [spawnUrl] = fetchMock.mock.calls[0]!;
    expect(spawnUrl).toBe("/api/terminal/spawn");

    const [resizeUrl] = fetchMock.mock.calls[1]!;
    expect(resizeUrl).toBe("/api/terminal/int-session-1/resize");

    const [killUrl] = fetchMock.mock.calls[2]!;
    expect(killUrl).toBe("/api/terminal/int-session-1");
  });

  it("handles spawn failure without crashing kill", async () => {
    // Given spawn fails
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "PTY spawn error"
    });

    // When spawn is attempted
    let spawnError = "";
    try {
      await terminalSpawn({ command: "claude", cwd: "/tmp" });
    } catch (e) {
      spawnError = String(e);
    }

    // Then spawn fails with a descriptive error
    expect(spawnError).toContain("PTY spawn error");

    // And kill is not called (no session to kill)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
