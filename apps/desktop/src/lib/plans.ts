export type PlanFileEntry = {
  filename: string;
  path: string;
  modifiedMs: number;
};

export type ValidationIssue = { path: string; message: string; code: string };

export type DiscoveredPlan = PlanFileEntry & {
  valid: boolean | null;
  validating: boolean;
  taskStatuses: unknown[];
  issues: ValidationIssue[];
};

export type ChangedPlanKind = "new" | "updated";

export type ChangedPlan = DiscoveredPlan & {
  kind: ChangedPlanKind;
};

// Baseline is captured when the dialog opens: filename -> modifiedMs
export type BaselineByFilename = ReadonlyMap<string, number>;

export function computeChangedPlans(plans: readonly DiscoveredPlan[], baseline: BaselineByFilename): ChangedPlan[] {
  // Spec-phase stub: implement in the green phase.
  return [];
}

