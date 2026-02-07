import type { Plan } from "./types.js";
import { CURRENT_PLAN_SPEC_VERSION } from "./validator.js";

type LegacyTask = {
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
  tests?: {
    bdd_scenarios?: string[];
    property_invariants?: string[];
    contract_tests?: string[];
  };
  documentation?: {
    updates?: string[];
    decision_notes?: string;
  };
};

type LegacyPlan = {
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
  tasks: LegacyTask[];
};

function migrateTask(task: LegacyTask): Plan["tasks"][number] {
  const migratedTask: Plan["tasks"][number] = {
    id: task.id,
    task_type: task.task_type,
    name: task.name,
    description: task.description,
    files: task.files,
    dependencies: task.dependencies,
    acceptance_criteria: task.acceptance_criteria,
    verification_command: task.verification_command,
    tests: {
      bdd_scenarios: task.tests?.bdd_scenarios ?? [],
      property_invariants: task.tests?.property_invariants ?? [],
      contract_tests: task.tests?.contract_tests ?? []
    },
    documentation: {
      updates: task.documentation?.updates ?? [],
      decision_notes: task.documentation?.decision_notes ?? ""
    }
  };

  if (task.steps) {
    migratedTask.steps = task.steps;
  }

  return migratedTask;
}

export function migratePlanToCurrentSpec(plan: LegacyPlan): Plan {
  return {
    metadata: {
      project: plan.metadata.project,
      created: plan.metadata.created,
      last_updated: new Date().toISOString(),
      spec_version: CURRENT_PLAN_SPEC_VERSION,
      approved: plan.metadata.approved
    },
    context: {
      goals: plan.context.goals,
      constraints: plan.context.constraints,
      tech_decisions: plan.context.tech_decisions,
      architecture: plan.context.architecture
    },
    tasks: plan.tasks.map((task) => migrateTask(task))
  };
}
