export type PlanTask = {
  id: string;
  task_type: string;
  name: string;
  description: string;
  files: string[];
  dependencies: string[];
  acceptance_criteria: string[];
  verification_command: string;
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
    spec_version: string;
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
  code: "schema" | "unknown_dependency" | "duplicate_task" | "cycle" | "unknown_task_type";
};

export type PlanValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};
