export type PlanTask = {
  id: string;
  task_type: string;
  name: string;
  description: string;
  files: string[];
  dependencies: string[];
  acceptance_criteria: string[];
  verification_command: string;
  tests: {
    bdd_scenarios: string[];
    property_invariants: string[];
    contract_tests: string[];
  };
  documentation: {
    updates: string[];
    decision_notes: string;
  };
  status?: "" | "spec" | "implement" | "refactor" | "document" | "completed";
  steps?: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
};

export type Plan = {
  metadata: {
    project: string;
    created: string;
    last_updated: string;
    spec_version: "v2";
    approved: boolean;
  };
  context: {
    goals: string[];
    constraints: string[];
    tech_decisions: Record<string, string>;
    architecture: "modulith";
  };
  tasks: PlanTask[];
};

export type ValidationIssue = {
  path: string;
  message: string;
  code:
    | "schema"
    | "unknown_dependency"
    | "duplicate_task"
    | "cycle"
    | "legacy_spec_version"
    | "missing_bdd_scenarios"
    | "missing_documentation_updates";
};

export type PlanValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};
