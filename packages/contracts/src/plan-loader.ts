import { readJsonFile } from "@forge/shared-utils";
import type { Plan } from "./types.js";

export async function loadPlan(path: string): Promise<Plan> {
  return await readJsonFile<Plan>(path);
}
