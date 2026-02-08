import type { SpawnConfig } from "../composables/useTerminal.js";

export function buildNewPlanSpawnConfig(adapter: string, projectRoot: string): SpawnConfig {
  return {
    command: adapter,
    cwd: projectRoot
  };
}
