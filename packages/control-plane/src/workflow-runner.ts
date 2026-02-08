import { readFile, writeFile } from "node:fs/promises";
import type { AdapterEvent, RunContext } from "@forge/shared-utils";
import type { AdapterFactory, AdapterType } from "./types.js";

export type GateResult = {
  ok: boolean;
  name?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type WorkflowGitClient = {
  currentBranch(): Promise<string>;
  commit(message: string): Promise<void>;
  push(remote: string): Promise<void>;
};

export type WorkflowRunnerDeps = {
  gateRunner: (phase: string, cwd: string) => Promise<GateResult>;
  git: WorkflowGitClient;
  onAdapterEvent?: (event: AdapterEvent) => void;
};

export type WorkflowAutoOptions = {
  maxRetries: number;
  push: boolean;
  remote?: string;
};

export type WorkflowAutoResult =
  | { state: "running"; taskId: string; phase: string }
  | { state: "paused"; taskId: string; phase: string; message: string }
  | { state: "completed"; message: string };

export class ForgeWorkflowRunner {
  constructor(
    private readonly workspaceRoot: string,
    private readonly adapterFactory: AdapterFactory,
    private readonly deps: WorkflowRunnerDeps
  ) {}

  async runAuto(planPath: string, adapterType: AdapterType, options: WorkflowAutoOptions): Promise<WorkflowAutoResult> {
    const remote = options.remote ?? "origin";

    const branch = await this.deps.git.currentBranch();
    if (branch === "main") {
      return { state: "paused", taskId: "", phase: "", message: "Refusing to run on main; use a codex/* branch." };
    }

    const plan = await readJson(planPath);
    const nextTask = selectNextRunnableTask(plan);
    if (!nextTask) {
      return { state: "completed", message: "No runnable tasks remain" };
    }

    const phase = nextPhase(nextTask.status);
    if (!phase) {
      // Should not happen because completed tasks are filtered out.
      nextTask.status = "completed";
      await writeJson(planPath, plan);
      return { state: "running", taskId: nextTask.id, phase: "completed" };
    }

    const adapter = this.adapterFactory(adapterType);
    const approvalMode = resolveApprovalMode();

    const basePrompt = renderPrompt(planPath, nextTask, phase);
    for (let attempt = 1; attempt <= Math.max(1, options.maxRetries); attempt += 1) {
      const prompt = attempt === 1 ? basePrompt : `${basePrompt}\n\nRetry ${String(attempt)}: Fix gate failures and try again.`;
      const ctx: RunContext = {
        taskId: nextTask.id,
        prompt,
        workingDirectory: this.workspaceRoot,
        allowedTools: [],
        approvalMode
      };

      const handle = await adapter.startRun(ctx);
      for await (const event of adapter.streamEvents(handle.runId)) {
        this.deps.onAdapterEvent?.(event);
      }

      const gate = await this.deps.gateRunner(phase, this.workspaceRoot);
      if (gate.ok) {
        // Mark phase as completed (plan schema does not track "commit" as a status).
        if (phase !== "commit") {
          nextTask.status = phase;
          await writeJson(planPath, plan);
        }

        const commitPrefix = phaseCommitPrefix(phase);
        if (commitPrefix) {
          await this.deps.git.commit(`${commitPrefix}: ${nextTask.id} - ${nextTask.name}`);
        }

        if (phase === "commit") {
          nextTask.status = "completed";
          await writeJson(planPath, plan);
          if (options.push) {
            await this.deps.git.push(remote);
          }
        }

        return { state: "running", taskId: nextTask.id, phase };
      }
    }

    return {
      state: "paused",
      taskId: nextTask.id,
      phase,
      message: `Gate failed for phase '${phase}' after ${String(options.maxRetries)} attempts.`
    };
  }
}

type PlanLike = {
  tasks: Array<{
    id: string;
    task_type: string;
    name: string;
    description: string;
    dependencies: string[];
    status?: "" | "spec" | "implement" | "refactor" | "document" | "completed";
  }>;
};

async function readJson(path: string): Promise<PlanLike> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as PlanLike;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveApprovalMode(): NonNullable<RunContext["approvalMode"]> {
  return process.stdin.isTTY ? "suggest" : "full-auto";
}

function isCompletedStatus(status: PlanLike["tasks"][number]["status"]): boolean {
  return status === "completed";
}

function selectNextRunnableTask(plan: PlanLike): PlanLike["tasks"][number] | undefined {
  const tasksById = new Map(plan.tasks.map((t) => [t.id, t]));
  return plan.tasks.find((task) => {
    if (isCompletedStatus(task.status)) return false;
    return task.dependencies.every((dep) => tasksById.get(dep)?.status === "completed");
  });
}

type Phase = "spec" | "implement" | "refactor" | "document" | "commit";

function nextPhase(status: PlanLike["tasks"][number]["status"]): Phase | undefined {
  const s = status ?? "";
  if (s === "") return "spec";
  if (s === "spec") return "implement";
  if (s === "implement") return "refactor";
  if (s === "refactor") return "document";
  if (s === "document") return "commit";
  return undefined;
}

function phaseCommitPrefix(phase: Phase): string | null {
  switch (phase) {
    case "spec":
      return "spec";
    case "implement":
      return "implement";
    case "refactor":
      return "refactor";
    case "document":
      return "docs";
    case "commit":
      return null;
  }
}

function renderPrompt(planPath: string, task: PlanLike["tasks"][number], phase: Phase): string {
  return [
    `Plan: ${planPath}`,
    `Task: ${task.id} - ${task.name}`,
    `Phase: ${phase}`,
    "",
    task.description
  ].join("\n");
}
