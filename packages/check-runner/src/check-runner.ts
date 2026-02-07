import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { exists, runCommand } from "@forge/shared-utils";
import type { CheckResult, CheckStatus } from "@forge/shared-utils";

export type TaskCheckBinding = {
  taskType: string;
  scripts: string[];
};

export interface CheckRunner {
  runChecks(taskType: string, taskId: string, cwd: string): Promise<CheckResult[]>;
}

export async function loadTaskTypeRegistry(checkRoot: string): Promise<Map<string, TaskCheckBinding>> {
  const registry = new Map<string, TaskCheckBinding>();
  const entries = await readdir(checkRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const script = join(checkRoot, entry.name, "gate-green.sh");
    registry.set(entry.name, {
      taskType: entry.name,
      scripts: [script]
    });
  }

  return registry;
}

function classifyStatus(exitCode: number, stdout: string, stderr: string): CheckStatus {
  if (exitCode === 0 && /flaky/i.test(`${stdout}${stderr}`)) {
    return "flaky";
  }
  if (exitCode === 0) {
    return "pass";
  }
  if (/not found|ENOENT/i.test(`${stdout}${stderr}`)) {
    return "infra_error";
  }
  return "fail";
}

export class ScriptCheckRunner implements CheckRunner {
  constructor(private readonly registry: Map<string, TaskCheckBinding>) {}

  async runChecks(taskType: string, taskId: string, cwd: string): Promise<CheckResult[]> {
    const binding = this.registry.get(taskType);
    if (!binding) {
      return [
        {
          name: `${taskType}:missing-binding`,
          status: "infra_error",
          summary: `No checks registered for task type ${taskType}`,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString()
        }
      ];
    }

    const results: CheckResult[] = [];

    for (const script of binding.scripts) {
      const startedAt = new Date().toISOString();
      if (!(await exists(script))) {
        results.push({
          name: script,
          status: "infra_error",
          summary: `Missing script for task ${taskId}`,
          startedAt,
          finishedAt: new Date().toISOString()
        });
        continue;
      }

      const output = await runCommand(script, [], cwd);
      const status = classifyStatus(output.exitCode, output.stdout, output.stderr);

      results.push({
        name: script,
        status,
        summary: `${output.stdout}${output.stderr}`.trim() || `status=${status}`,
        startedAt,
        finishedAt: new Date().toISOString()
      });
    }

    return results;
  }
}
