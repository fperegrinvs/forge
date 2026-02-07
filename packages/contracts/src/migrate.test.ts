import { describe, expect, it } from "vitest";
import { migratePlanToCurrentSpec } from "./migrate.js";
import { validatePlanSchema } from "./validator.js";

describe("migratePlanToCurrentSpec", () => {
  it("upgrades v1 plans to current schema", async () => {
    const legacyPlan = {
      metadata: {
        project: "forge",
        created: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        spec_version: "v1",
        approved: true
      },
      context: {
        goals: ["goal"],
        constraints: ["constraint"],
        tech_decisions: {},
        architecture: "modulith"
      },
      tasks: [
        {
          id: "task-1",
          task_type: "implementation",
          name: "Task",
          description: "desc",
          files: ["a.ts"],
          dependencies: [],
          acceptance_criteria: ["done"],
          verification_command: "echo ok"
        }
      ]
    };

    const migrated = migratePlanToCurrentSpec(legacyPlan);
    expect(migrated.metadata.spec_version).toBe("v2");
    expect(migrated.tasks[0]?.tests.bdd_scenarios).toEqual([]);
    expect(migrated.tasks[0]?.documentation.updates).toEqual([]);

    const validation = await validatePlanSchema(migrated);
    expect(validation.valid).toBe(true);
  });
});
