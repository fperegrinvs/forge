import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import type { Plan, PlanValidationResult, ValidationIssue } from "./types.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

async function loadSchema(): Promise<object> {
  const builtPath = join(currentDir, "schema", "plan.v1.schema.json");
  const sourcePath = join(currentDir, "..", "src", "schema", "plan.v1.schema.json");
  const raw = await readFile(builtPath, "utf8").catch(() => readFile(sourcePath, "utf8"));
  return JSON.parse(raw) as object;
}

function toIssue(error: ErrorObject<string, Record<string, unknown>>): ValidationIssue {
  return {
    path: error.instancePath || "/",
    message: error.message ?? "validation error",
    code: "schema"
  };
}

export async function validatePlanSchema(plan: unknown): Promise<PlanValidationResult> {
  const ajv = new Ajv2020.Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const schema = await loadSchema();
  const validate = ajv.compile(schema);
  const valid = validate(plan);

  return {
    valid,
    issues: valid ? [] : (validate.errors ?? []).map(toIssue)
  };
}

function detectCycle(plan: Plan): string[] {
  const deps = new Map<string, string[]>();
  for (const task of plan.tasks) {
    deps.set(task.id, task.dependencies);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();

  const walk = (node: string): string[] => {
    if (stack.has(node)) {
      return [node];
    }
    if (visited.has(node)) {
      return [];
    }

    visited.add(node);
    stack.add(node);

    const children = deps.get(node) ?? [];
    for (const child of children) {
      const cycle = walk(child);
      if (cycle.length > 0) {
        return [node, ...cycle];
      }
    }

    stack.delete(node);
    return [];
  };

  for (const task of plan.tasks) {
    const cycle = walk(task.id);
    if (cycle.length > 0) {
      return cycle;
    }
  }

  return [];
}

export function validatePlanGraph(plan: Plan, registeredTaskTypes: Set<string>): PlanValidationResult {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();

  for (const task of plan.tasks) {
    if (ids.has(task.id)) {
      issues.push({
        path: `/tasks/${task.id}`,
        message: `Duplicate task id: ${task.id}`,
        code: "duplicate_task"
      });
    }
    ids.add(task.id);

    if (!registeredTaskTypes.has(task.task_type)) {
      issues.push({
        path: `/tasks/${task.id}/task_type`,
        message: `Unknown task type: ${task.task_type}`,
        code: "unknown_task_type"
      });
    }
  }

  for (const task of plan.tasks) {
    for (const dep of task.dependencies) {
      if (!ids.has(dep)) {
        issues.push({
          path: `/tasks/${task.id}/dependencies`,
          message: `Unknown dependency id: ${dep}`,
          code: "unknown_dependency"
        });
      }
    }
  }

  const cycle = detectCycle(plan);
  if (cycle.length > 0) {
    issues.push({
      path: "/tasks",
      message: `Cyclic dependency detected: ${cycle.join(" -> ")}`,
      code: "cycle"
    });
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
