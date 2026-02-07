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

    const taskTypeDir = join(checkRoot, entry.name);
    const taskTypeEntries = await readdir(taskTypeDir, { withFileTypes: true });
    const scripts = taskTypeEntries
      .filter((file) => file.isFile() && /^gate-.*\.sh$/.test(file.name))
      .map((file) => join(taskTypeDir, file.name))
      .sort();

    registry.set(entry.name, {
      taskType: entry.name,
      scripts
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
    if (!binding || binding.scripts.length === 0) {
      return [];
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
