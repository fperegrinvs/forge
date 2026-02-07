import { describe, expect, it } from "vitest";
import type { Plan } from "./types.js";
import { validatePlanGraph, validatePlanSchema } from "./validator.js";

const basePlan: Plan = {
  metadata: {
    project: "forge",
    created: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    spec_version: "v1",
    approved: true
  },
  context: {
    goals: ["test"],
    constraints: ["none"],
    tech_decisions: {},
    architecture: "modulith"
  },
  tasks: [
    {
      id: "task-a",
      task_type: "implementation",
      name: "Task A",
      description: "desc",
      files: ["a.ts"],
      dependencies: [],
      acceptance_criteria: ["works"],
      verification_command: "echo ok"
    }
  ]
};

describe("validatePlanSchema", () => {
  it("accepts valid schema", async () => {
    const result = await validatePlanSchema(basePlan);
    expect(result.valid).toBe(true);
  });

  it("rejects missing task_type", async () => {
    const invalid = {
      ...basePlan,
      tasks: [
        {
          ...basePlan.tasks[0],
          task_type: undefined
        }
      ]
    };

    const result = await validatePlanSchema(invalid);
    expect(result.valid).toBe(false);
  });
});

describe("validatePlanGraph", () => {
  it("rejects unknown dependency ids", () => {
    const plan: Plan = {
      ...basePlan,
      tasks: [
        {
          ...basePlan.tasks[0],
          dependencies: ["missing"]
        }
      ]
    };

    const result = validatePlanGraph(plan, new Set(["implementation"]));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "unknown_dependency")).toBe(true);
  });

  it("rejects cycles", () => {
    const plan: Plan = {
      ...basePlan,
      tasks: [
        {
          ...basePlan.tasks[0],
          id: "a",
          dependencies: ["b"]
        },
        {
          ...basePlan.tasks[0],
          id: "b",
          dependencies: ["a"]
        }
      ]
    };

    const result = validatePlanGraph(plan, new Set(["implementation"]));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "cycle")).toBe(true);
  });

  it("rejects unknown task types", () => {
    const result = validatePlanGraph(basePlan, new Set(["testing"]));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "unknown_task_type")).toBe(true);
  });

  it("rejects duplicate task ids", () => {
    const plan: Plan = {
      ...basePlan,
      tasks: [
        { ...basePlan.tasks[0], id: "dup" },
        { ...basePlan.tasks[0], id: "dup" }
      ]
    };

    const result = validatePlanGraph(plan, new Set(["implementation"]));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "duplicate_task")).toBe(true);
  });
});
