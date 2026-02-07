// Barrel export: only expose the public API of this module.
// Other modules import through this file — never reach into internal directories.
export { StarterService } from "./services/starter.service.js";
export type { Starter, CreateStarterInput } from "./domain/types.js";
