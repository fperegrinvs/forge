import { invoke } from "@tauri-apps/api/core";

export type ValidateResult = {
  valid: boolean;
  issues: Array<{ path: string; message: string; code: string }>;
};

export type RunNextResult = {
  state: string;
  taskId?: string;
  externalRunId?: string;
  resumeCommand?: string;
  message: string;
};

export async function planValidate(filePath: string): Promise<ValidateResult> {
  return await invoke<ValidateResult>("plan_validate", { filePath });
}

export async function runNext(planPath: string, adapter: "codex" | "claude"): Promise<RunNextResult> {
  return await invoke<RunNextResult>("run_next", { planPath, adapter });
}

export async function pauseRun(runId: string): Promise<boolean> {
  return await invoke<boolean>("pause_run", { runId });
}

export async function resumeRun(runId: string): Promise<boolean> {
  return await invoke<boolean>("resume_run", { runId });
}

export async function getEvidence(taskId: string): Promise<string[]> {
  return await invoke<string[]>("get_evidence", { taskId });
}
