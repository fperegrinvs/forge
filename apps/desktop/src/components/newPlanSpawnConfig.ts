import type { SpawnConfig } from "../composables/useTerminal.js";

export function buildNewPlanSpawnConfig(adapter: string, projectRoot: string): SpawnConfig {
  if (adapter === "codex") {
    return {
      command: "codex",
      args: ["--no-alt-screen"],
      cwd: projectRoot,
      env: {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        RUST_BACKTRACE: "1"
      }
    };
  }

  return {
    command: adapter,
    cwd: projectRoot
  };
}
