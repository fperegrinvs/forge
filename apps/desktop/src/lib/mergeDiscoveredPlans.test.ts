import { describe, expect, it } from "vitest";

import { mergeDiscoveredPlans } from "./mergeDiscoveredPlans.js";
import type { DiscoveredPlan, PlanFileEntry } from "./plans.js";

describe("mergeDiscoveredPlans", () => {
  it("preserves object identity for existing plans and updates modifiedMs", () => {
    // Given a previous discovered plan
    const prev: DiscoveredPlan = {
      filename: "a.json",
      path: "/p/plans/a.json",
      modifiedMs: 1000,
      valid: true,
      validating: false,
      taskStatuses: [],
      issues: []
    };

    // When entries include the same plan with a newer modifiedMs
    const entries: PlanFileEntry[] = [{ filename: "a.json", path: "/p/plans/a.json", modifiedMs: 2000 }];
    const result = mergeDiscoveredPlans([prev], entries, { guidedOpen: true });

    // Then identity is preserved and modifiedMs is updated
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toBe(prev);
    expect(result.plans[0]!.modifiedMs).toBe(2000);
  });

  it("marks updated plans to be revalidated and emits update signal when guidedOpen", () => {
    // Given a previously validated plan
    const prev: DiscoveredPlan = {
      filename: "a.json",
      path: "/p/plans/a.json",
      modifiedMs: 1000,
      valid: true,
      validating: false,
      taskStatuses: [],
      issues: [{ path: "x", code: "old_issue", message: "old" }]
    };

    // When the plan is updated on disk
    const entries: PlanFileEntry[] = [{ filename: "a.json", path: "/p/plans/a.json", modifiedMs: 2000 }];
    const result = mergeDiscoveredPlans([prev], entries, { guidedOpen: true });

    // Then it is reset for validation and the update signal is emitted
    expect(result.plans[0]!.valid).toBeNull();
    expect(result.plans[0]!.issues).toEqual([]);
    expect(result.updatedFilenames).toEqual(["a.json"]);
  });

  it("does not emit update signal when guidedOpen=false", () => {
    // Given a plan that gets updated
    const prev: DiscoveredPlan = {
      filename: "a.json",
      path: "/p/plans/a.json",
      modifiedMs: 1000,
      valid: true,
      validating: false,
      taskStatuses: [],
      issues: []
    };

    // When merge is called outside guided flow
    const entries: PlanFileEntry[] = [{ filename: "a.json", path: "/p/plans/a.json", modifiedMs: 2000 }];
    const result = mergeDiscoveredPlans([prev], entries, { guidedOpen: false });

    // Then no update signal is emitted
    expect(result.updatedFilenames).toEqual([]);
  });
});
