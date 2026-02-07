import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn()
}));

import { terminalKill, terminalResize, terminalSpawn, terminalWsUrl } from "./useTerminal";

describe("useTerminal", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "http://localhost:1420", protocol: "http:", host: "localhost:1420" } });
  });

  it("spawns a terminal session", async () => {
    // Given the backend returns a session id
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: "abc-123" })
    });
    // When spawn is called
    const result = await terminalSpawn({ command: "claude", args: [], cwd: "/tmp/project" });
    // Then the API is called with correct body and session id is returned
    expect(result.sessionId).toBe("abc-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/terminal/spawn");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init!.body as string);
    expect(body.command).toBe("claude");
    expect(body.cwd).toBe("/tmp/project");
  });

  it("kills a terminal session", async () => {
    // Given the backend returns success
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => true
    });
    // When kill is called
    const result = await terminalKill("abc-123");
    // Then the correct DELETE endpoint is called
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/terminal/abc-123");
    expect(init?.method).toBe("DELETE");
  });

  it("resizes a terminal session", async () => {
    // Given the backend returns success
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => true
    });
    // When resize is called
    const result = await terminalResize("abc-123", 120, 40);
    // Then the correct endpoint is called with size
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/terminal/abc-123/resize");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init!.body as string);
    expect(body.cols).toBe(120);
    expect(body.rows).toBe(40);
  });

  it("computes WebSocket URL from session id", () => {
    // Given a session id and current location
    // When wsUrl is computed
    const url = terminalWsUrl("abc-123");
    // Then a WebSocket URL is returned
    expect(url).toBe("ws://localhost:1420/api/terminal/abc-123/ws");
  });
});
