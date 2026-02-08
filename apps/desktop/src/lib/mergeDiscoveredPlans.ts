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
  const existing = new Map(prevPlans.map((p) => [p.filename, p]));
  const next: DiscoveredPlan[] = [];
  const updatedFilenames: string[] = [];

  for (const entry of entries) {
    const prev = existing.get(entry.filename);
    if (!prev) {
      next.push({
        filename: entry.filename,
        path: entry.path,
        modifiedMs: entry.modifiedMs,
        valid: null,
        validating: false,
        taskStatuses: [],
        issues: []
      });
      continue;
    }

    const wasModifiedMs = prev.modifiedMs;
    prev.path = entry.path;
    prev.modifiedMs = entry.modifiedMs;
    next.push(prev);

    if (entry.modifiedMs > wasModifiedMs) {
      // Reset validation state so polling will re-validate the updated content.
      prev.valid = null;
      prev.issues = [];
      prev.validating = false;
      if (opts.guidedOpen) updatedFilenames.push(entry.filename);
    }
  }

  return { plans: next, updatedFilenames };
}
