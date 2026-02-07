import { describe, expect, it } from "vitest";
import { migratePlanToCurrentSpec } from "./migrate.js";
import { validatePlanSchema } from "./validator.js";

describe("migratePlanToCurrentSpec", () => {
  it("upgrades v1 plans to current schema", async () => {
    // Given a legacy plan missing tests/documentation metadata
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

  it("preserves steps and copies tests/documentation when present", async () => {
    // Given a legacy plan with steps, tests, and documentation fields populated
    const legacyPlan = {
      metadata: {
        project: "forge",
        created: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        spec_version: "v1",
        approved: false
      },
      context: {
        goals: ["goal"],
        constraints: ["constraint"],
        tech_decisions: { decision: "value" },
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
          verification_command: "echo ok",
          steps: [{ id: "s1", name: "Step 1" }],
          tests: {
            bdd_scenarios: ["Given ... When ... Then ..."],
            property_invariants: ["invariant"],
            contract_tests: ["contract"]
          },
          documentation: {
            updates: ["README.md"],
            decision_notes: "notes"
          }
        }
      ]
    };

    // When the plan is migrated
    const migrated = migratePlanToCurrentSpec(legacyPlan);

    // Then steps and metadata are preserved/migrated appropriately
    expect(migrated.metadata.spec_version).toBe("v2");
    expect(migrated.metadata.approved).toBe(false);
    expect(migrated.context.tech_decisions).toEqual({ decision: "value" });
    expect(migrated.tasks[0]?.steps).toEqual([{ id: "s1", name: "Step 1" }]);
    expect(migrated.tasks[0]?.tests.bdd_scenarios).toEqual(["Given ... When ... Then ..."]);
    expect(migrated.tasks[0]?.documentation.updates).toEqual(["README.md"]);

    const validation = await validatePlanSchema(migrated);
    expect(validation.valid).toBe(true);
  });
});
