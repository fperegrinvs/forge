import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn()
}));

import { terminalKill, terminalSpawn } from "../composables/useTerminal";
import { getSkillInvocation } from "./planDialogInstructions";
import { buildNewPlanSpawnConfig } from "./newPlanSpawnConfig";

describe("NewPlanDialog spawn/kill lifecycle", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "http://localhost:1420", protocol: "http:", host: "localhost:1420" } });
  });

  it("spawns terminal on open and kills on close", async () => {
    // Given a backend that returns a session on spawn and success on kill
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: "session-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => true
      });

    // When a terminal is spawned
    const spawnResult = await terminalSpawn({ command: "claude", cwd: "/tmp/project" });

    // Then a session id is returned
    expect(spawnResult.sessionId).toBe("session-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [spawnUrl, spawnInit] = fetchMock.mock.calls[0]!;
    expect(spawnUrl).toBe("/api/terminal/spawn");
    expect(spawnInit?.method).toBe("POST");

    // When the terminal is killed
    const killResult = await terminalKill("session-1");

    // Then it succeeds
    expect(killResult).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [killUrl, killInit] = fetchMock.mock.calls[1]!;
    expect(killUrl).toBe("/api/terminal/session-1");
    expect(killInit?.method).toBe("DELETE");
  });

  it("handles spawn failure gracefully", async () => {
    // Given a backend that returns an error on spawn
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "spawn failed"
    });

    // When spawn is called
    // Then it throws an error
    await expect(terminalSpawn({ command: "claude", cwd: "/tmp" })).rejects.toThrow("spawn failed");
  });
});

describe("NewPlanDialog adapter-specific instructions", () => {
  it("returns slash command for claude adapter", () => {
    // Given the claude adapter
    // When getting the skill invocation
    const result = getSkillInvocation("claude");
    // Then it returns a slash command
    expect(result).toBe("Type `/plan-guided` and press Enter");
  });

  it("returns mention syntax for codex adapter", () => {
    // Given the codex adapter
    // When getting the skill invocation
    const result = getSkillInvocation("codex");
    // Then it returns a mention with description prompt
    expect(result).toBe("Mention `$plan-guided` and describe your feature");
  });

  it("falls back to slash command for unknown adapters", () => {
    // Given an unknown adapter
    // When getting the skill invocation
    const result = getSkillInvocation("some-other-agent");
    // Then it falls back to the slash command syntax
    expect(result).toBe("Type `/plan-guided` and press Enter");
  });
});

describe("new plan spawn config", () => {
  it("builds claude config", () => {
    const config = buildNewPlanSpawnConfig("claude", "/tmp/project");
    expect(config).toEqual({ command: "claude", cwd: "/tmp/project" });
  });

  it("builds default config for other adapters", () => {
    const config = buildNewPlanSpawnConfig("codex", "/tmp/project");
    expect(config).toEqual({ command: "codex", cwd: "/tmp/project" });
  });
});
