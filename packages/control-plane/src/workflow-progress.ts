type Phase = "spec" | "implement" | "refactor" | "document" | "commit";

type TaskStatus = "" | "spec" | "implement" | "refactor" | "document" | "completed" | undefined;

type PlanLike = {
  tasks: Array<{
    id: string;
    task_type: string;
    name: string;
    description: string;
    dependencies: string[];
    status?: TaskStatus;
  }>;
};

function isCompleted(status: TaskStatus): boolean {
  return status === "completed";
}

function completedPhases(status: TaskStatus): Set<Phase> {
  const phases = new Set<Phase>();
  if (status === "completed") {
    phases.add("spec");
    phases.add("implement");
    phases.add("refactor");
    phases.add("document");
    phases.add("commit");
    return phases;
  }
  if (status === "spec") phases.add("spec");
  if (status === "implement") {
    phases.add("spec");
    phases.add("implement");
  }
  if (status === "refactor") {
    phases.add("spec");
    phases.add("implement");
    phases.add("refactor");
  }
  if (status === "document") {
    phases.add("spec");
    phases.add("implement");
    phases.add("refactor");
    phases.add("document");
  }
  return phases;
}

function nextPhase(status: TaskStatus): Phase | undefined {
  const s = status ?? "";
  if (s === "") return "spec";
  if (s === "spec") return "implement";
  if (s === "implement") return "refactor";
  if (s === "refactor") return "document";
  if (s === "document") return "commit";
  return undefined;
}

export function renderWorkflowProgress(plan: PlanLike): string {
  const tasksById = new Map(plan.tasks.map((t) => [t.id, t]));
  const phases: Phase[] = ["spec", "implement", "refactor", "document", "commit"];

  const lines: string[] = [];
  lines.push("Workflow progress:");

  for (const task of plan.tasks) {
    const done = isCompleted(task.status);
    const depsMissing = task.dependencies.filter((dep) => !isCompleted(tasksById.get(dep)?.status));
    const blockedSuffix = !done && depsMissing.length > 0 ? ` (blocked: ${depsMissing.join(", ")})` : "";
    lines.push(`${done ? "[x]" : "[ ]"} ${task.id} - ${task.name}${blockedSuffix}`);

    const completed = completedPhases(task.status);
    const next = done ? undefined : depsMissing.length > 0 ? undefined : nextPhase(task.status);
    const phaseParts = phases.map((p) => {
      if (completed.has(p)) return `[x] ${p}`;
      if (next === p) return `[>] ${p}`;
      return `[ ] ${p}`;
    });
    lines.push(`    phases: ${phaseParts.join(" ")}`);
  }

  return `${lines.join("\n")}\n`;
}

