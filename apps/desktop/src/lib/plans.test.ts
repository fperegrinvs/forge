import { describe, expect, it } from "vitest";

import type { BaselineByFilename, DiscoveredPlan } from "./plans.js";
import { computeChangedPlans } from "./plans.js";

describe("computeChangedPlans", () => {
  it("returns updated when modifiedMs increased vs baseline", () => {
    // Given a baseline for an existing plan
    const baseline: BaselineByFilename = new Map([["a.json", 1000]]);
    const plans: DiscoveredPlan[] = [
      { filename: "a.json", path: "/p/plans/a.json", modifiedMs: 2000, valid: true, validating: false, taskStatuses: [], issues: [] }
    ];

    // When computing changes
    const changed = computeChangedPlans(plans, baseline);

    // Then the plan is marked as updated
    expect(changed).toHaveLength(1);
    expect(changed[0]!.filename).toBe("a.json");
    expect(changed[0]!.kind).toBe("updated");
  });

  it("returns new when plan was not in baseline", () => {
    // Given a baseline that does not include the plan
    const baseline: BaselineByFilename = new Map([["a.json", 1000]]);
    const plans: DiscoveredPlan[] = [
      { filename: "b.json", path: "/p/plans/b.json", modifiedMs: 5000, valid: null, validating: false, taskStatuses: [], issues: [] }
    ];

    // When computing changes
    const changed = computeChangedPlans(plans, baseline);

    // Then the plan is marked as new
    expect(changed).toHaveLength(1);
    expect(changed[0]!.filename).toBe("b.json");
    expect(changed[0]!.kind).toBe("new");
  });

  it("does not return unchanged plans", () => {
    // Given a baseline matching the current modifiedMs
    const baseline: BaselineByFilename = new Map([["a.json", 2000]]);
    const plans: DiscoveredPlan[] = [
      { filename: "a.json", path: "/p/plans/a.json", modifiedMs: 2000, valid: true, validating: false, taskStatuses: [], issues: [] }
    ];

    // When computing changes
    const changed = computeChangedPlans(plans, baseline);

    // Then nothing is returned
    expect(changed).toEqual([]);
  });
});
