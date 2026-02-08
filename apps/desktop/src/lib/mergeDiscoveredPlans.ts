import type { DiscoveredPlan, PlanFileEntry } from "./plans.js";

export type MergeResult = {
  plans: DiscoveredPlan[];
  // Filenames updated (existing entry whose modifiedMs increased)
  updatedFilenames: string[];
};

export function mergeDiscoveredPlans(
  prevPlans: readonly DiscoveredPlan[],
  entries: readonly PlanFileEntry[],
  opts: { guidedOpen: boolean }
): MergeResult {
  // Spec-phase stub: implement in the green phase.
  return { plans: [...prevPlans], updatedFilenames: [] };
}
