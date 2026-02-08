import type { SidecarCommand } from "./index.js";

export async function runSidecarCommand(_cmd: SidecarCommand): Promise<unknown> {
  // Intentionally unimplemented in spec phase.
  throw new Error("not implemented");
}
