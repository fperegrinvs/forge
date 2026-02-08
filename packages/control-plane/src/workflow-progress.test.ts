import { describe, expect, it } from "vitest";
import { renderWorkflowProgress } from "./workflow-progress.js";

describe("renderWorkflowProgress", () => {
  it("renders task completion, per-phase markers, and blocked dependencies", () => {
    // Given a plan with completed, in-progress, and blocked tasks
    const plan = {
      tasks: [
        { id: "task-1", task_type: "implementation", name: "Task 1", description: "", dependencies: [], status: "completed" as const },
        { id: "task-2", task_type: "implementation", name: "Task 2", description: "", dependencies: ["task-1"], status: "spec" as const },
        { id: "task-3", task_type: "implementation", name: "Task 3", description: "", dependencies: ["task-2"], status: "" as const }
      ]
    };

    // When progress is rendered
    const out = renderWorkflowProgress(plan);

    // Then completed tasks are marked and phases reflect next work
    expect(out).toContain("[x] task-1 - Task 1");
    expect(out).toContain("phases: [x] spec [x] implement [x] refactor [x] document [x] commit");
    expect(out).toContain("[ ] task-2 - Task 2");
    expect(out).toContain("phases: [x] spec [>] implement [ ] refactor [ ] document [ ] commit");

    // And blocked tasks show unmet dependencies
    expect(out).toContain("[ ] task-3 - Task 3 (blocked: task-2)");
  });
});

