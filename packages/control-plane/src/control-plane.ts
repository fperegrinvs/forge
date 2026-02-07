import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CodexAdapter } from "@forge/adapter-codex";
import { ClaudeAdapter } from "@forge/adapter-claude";
import { ScriptCheckRunner, loadTaskTypeRegistry } from "@forge/check-runner";
import { loadPlan, validatePlanGraph, validatePlanSchema, validatePlanWorkflow } from "@forge/contracts";
import { exists, writeJsonFile } from "@forge/shared-utils";
import type { AdapterEvent, AgentAdapter, CheckResult, RunContext } from "@forge/shared-utils";
import type { AdapterFactory, AdapterType, RunNextResult, RuntimeState, TaskState } from "./types.js";

type RunNextHooks = {
  onAdapterEvent?: (event: AdapterEvent) => void;
};

function buildDefaultAdapterFactory(): AdapterFactory {
  return (type: AdapterType): AgentAdapter => {
    if (type === "codex") {
      return new CodexAdapter();
    }
    return new ClaudeAdapter();
  };
}

function classifyFailure(checks: CheckResult[], events: AdapterEvent[]): RunNextResult["classification"] {
  if (checks.some((check) => check.status === "infra_error")) {
    return "infrastructure";
  }

  if (checks.some((check) => check.status === "fail" || check.status === "flaky")) {
    return "structural";
  }

  const failedEvent = events.find(
    (event): event is Extract<AdapterEvent, { type: "run.failed" }> => event.type === "run.failed"
  );
  if (failedEvent) {
    if (/oom|context|crash|overflow/i.test(failedEvent.reason)) {
      return "infrastructure";
    }
    return "semantic";
  }

  return undefined;
}

function buildResumeCommand(adapterType: AdapterType, externalRunId?: string): string | undefined {
  if (adapterType === "codex" && externalRunId) {
    return `codex resume ${externalRunId}`;
  }

  return undefined;
}

async function writeEvents(evidenceDir: string, events: AdapterEvent[]): Promise<void> {
  const path = join(evidenceDir, "adapter-events.jsonl");
  const lines = events.map((event) => JSON.stringify(event)).join("\n");
  await writeFile(path, `${lines}\n`, "utf8");
}

export class ForgeControlPlane {
  private readonly statePath: string;
  private readonly evidenceRoot: string;

  constructor(
    private readonly workspaceRoot: string,
    private readonly adapterFactory: AdapterFactory = buildDefaultAdapterFactory()
  ) {
    this.statePath = join(this.workspaceRoot, ".forge", "state.json");
    this.evidenceRoot = join(this.workspaceRoot, ".forge", "evidence");
  }

  private resolveApprovalMode(): NonNullable<RunContext["approvalMode"]> {
    // Desktop/CI runs are often non-interactive. "suggest" can deadlock because adapters
    // may prompt for approval but receive no stdin. Prefer full-auto when no TTY.
    return process.stdin.isTTY ? "suggest" : "full-auto";
  }

  async planValidate(planPath: string) {
    const plan = await loadPlan(planPath);
    const schema = await validatePlanSchema(plan);
    if (!schema.valid) {
      return schema;
    }

    const graph = validatePlanGraph(plan);
    if (!graph.valid) {
      return graph;
    }

    return validatePlanWorkflow(plan);
  }

  async runNext(
    planPath: string,
    adapterType: AdapterType,
    checkRoot = join(this.workspaceRoot, "checks", "task-types"),
    hooks?: RunNextHooks
  ): Promise<RunNextResult> {
    const validation = await this.planValidate(planPath);
    if (!validation.valid) {
      return {
        state: "failed",
        message: "Plan validation failed"
      };
    }

    const plan = await loadPlan(planPath);
    const state = await this.loadState(planPath, plan.tasks.map((task) => task.id));

    // Auto-resume: if paused, unlock state so the next task can proceed
    if (state.pausedRun) {
      if (state.pausedRun.taskId && state.tasks[state.pausedRun.taskId] === "paused") {
        state.tasks[state.pausedRun.taskId] = "pending";
      } else {
        const pausedTaskId = Object.entries(state.tasks).find(([, s]) => s === "paused")?.[0];
        if (pausedTaskId) state.tasks[pausedTaskId] = "pending";
      }
      delete state.pausedRun;
      await this.saveState(state);
    }

    const nextTask = plan.tasks.find(
      (task) =>
        state.tasks[task.id] === "pending" &&
        task.dependencies.every((dependency) => state.tasks[dependency] === "completed")
    );

    if (!nextTask) {
      return {
        state: "completed",
        message: "No runnable tasks remain"
      };
    }

    state.tasks[nextTask.id] = "running";
    await this.saveState(state);

    const adapter = this.adapterFactory(adapterType);
    const runContext: RunContext = {
      taskId: nextTask.id,
      prompt: `${nextTask.name}\n\n${nextTask.description}`,
      workingDirectory: this.workspaceRoot,
      allowedTools: [],
      approvalMode: this.resolveApprovalMode()
    };

    const startedRun = await adapter.startRun(runContext);
    const runId = startedRun.runId;
    let externalRunId = startedRun.externalRunId;
    const events: AdapterEvent[] = [];

    for await (const event of adapter.streamEvents(runId)) {
      events.push(event);
      hooks?.onAdapterEvent?.(event);
    }

    if (!externalRunId) {
      try {
        const resumedRun = await adapter.resume(runId);
        externalRunId = resumedRun.externalRunId;
      } catch {
        externalRunId = undefined;
      }
    }

    const registry = await loadTaskTypeRegistry(checkRoot);
    const runner = new ScriptCheckRunner(registry);
    const checks = await runner.runChecks(nextTask.task_type, nextTask.id, this.workspaceRoot);

    const evidenceDir = join(this.evidenceRoot, `${nextTask.id}-${String(Date.now())}`);
    await mkdir(evidenceDir, { recursive: true });
    await writeJsonFile(join(evidenceDir, "run-metadata.json"), {
      taskId: nextTask.id,
      runId,
      externalRunId,
      adapterType,
      at: new Date().toISOString()
    });
    await writeJsonFile(join(evidenceDir, "checks.json"), checks);
    await writeEvents(evidenceDir, events);
    await this.saveEvidenceIndex(nextTask.id, evidenceDir);

    const classification = classifyFailure(checks, events);

    if (classification) {
      const resumeCommand = buildResumeCommand(adapterType, externalRunId);
      state.tasks[nextTask.id] = "paused";
      state.pausedRun = {
        runId,
        taskId: nextTask.id,
        adapterType,
        ...(externalRunId ? { externalRunId } : {})
      };
      await this.saveState(state);
      return {
        taskId: nextTask.id,
        state: "paused",
        classification,
        runId,
        ...(externalRunId ? { externalRunId } : {}),
        ...(resumeCommand ? { resumeCommand } : {}),
        checks,
        events,
        message: `Task paused due to ${classification} failure`
      };
    }

    state.tasks[nextTask.id] = "completed";
    delete state.pausedRun;
    await this.saveState(state);

    return {
      taskId: nextTask.id,
      state: "completed",
      runId,
      ...(externalRunId ? { externalRunId } : {}),
      checks,
      events,
      message: "Task completed"
    };
  }

  async pause(runId: string): Promise<void> {
    const state = await this.loadState("", []);
    state.pausedRun = { runId };
    await this.saveState(state);
  }

  async resume(runId: string): Promise<boolean> {
    const state = await this.loadState("", []);
    if (!state.pausedRun || state.pausedRun.runId !== runId) {
      return false;
    }

    if (state.pausedRun.taskId && state.tasks[state.pausedRun.taskId] === "paused") {
      state.tasks[state.pausedRun.taskId] = "pending";
    } else {
      const pausedTaskId = Object.entries(state.tasks).find(([, taskState]) => taskState === "paused")?.[0];
      if (pausedTaskId) {
        state.tasks[pausedTaskId] = "pending";
      }
    }

    delete state.pausedRun;
    await this.saveState(state);
    return true;
  }

  async getEvidence(taskId: string): Promise<string[]> {
    if (!(await exists(this.evidenceRoot))) {
      return [];
    }

    const entries = await readFile(join(this.evidenceRoot, "index.json"), "utf8").catch(() => "[]");
    const parsed = JSON.parse(entries) as Array<{ taskId: string; dir: string }>;
    return parsed.filter((entry) => entry.taskId === taskId).map((entry) => entry.dir);
  }

  private async saveEvidenceIndex(taskId: string, dir: string): Promise<void> {
    const indexPath = join(this.evidenceRoot, "index.json");
    const current = await readFile(indexPath, "utf8").catch(() => "[]");
    const parsed = JSON.parse(current) as Array<{ taskId: string; dir: string }>;
    parsed.push({ taskId, dir });
    await mkdir(this.evidenceRoot, { recursive: true });
    await writeFile(indexPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  private async loadState(planPath: string, taskIds: string[]): Promise<RuntimeState> {
    if (!(await exists(this.statePath))) {
      const initial: RuntimeState = {
        planPath,
        tasks: Object.fromEntries(taskIds.map((id) => [id, "pending" as TaskState]))
      };
      await this.saveState(initial);
      return initial;
    }

    const raw = await readFile(this.statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeState> & { pausedRunId?: string };
    const existing: RuntimeState = {
      planPath: typeof parsed.planPath === "string" ? parsed.planPath : planPath,
      tasks: parsed.tasks ?? {},
      ...(parsed.pausedRun ? { pausedRun: parsed.pausedRun } : {})
    };

    // Migrate legacy pausedRunId field from old state files
    if (!existing.pausedRun && parsed.pausedRunId) {
      existing.pausedRun = { runId: parsed.pausedRunId };
    }

    for (const id of taskIds) {
      if (!existing.tasks[id]) {
        existing.tasks[id] = "pending";
      }
    }

    return existing;
  }

  private async saveState(state: RuntimeState): Promise<void> {
    await mkdir(join(this.workspaceRoot, ".forge"), { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}
