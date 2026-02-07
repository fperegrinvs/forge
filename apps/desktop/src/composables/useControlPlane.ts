import { invoke } from "@tauri-apps/api/core";

export type ValidationIssue = { path: string; message: string; code: string };

export type ValidateResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

export type RunNextResult = {
  state: string;
  taskId?: string;
  runId?: string;
  externalRunId?: string;
  resumeCommand?: string;
  message: string;
};

export type GuidanceManifest = {
  name?: string;
  version?: string;
  workflowPolicyVersion?: string;
  workflowPolicyHash?: string;
};

export type ProjectGuidanceStatus = {
  installed: boolean;
  manifest?: GuidanceManifest;
};

export type InstalledPack = {
  name: string;
  version: string;
  path: string;
};

export type PackUpdateStatus = {
  name: string;
  installedVersion?: string;
  latestVersion?: string;
  hasUpdate: boolean;
};

export async function planValidate(projectRoot: string, planPath: string): Promise<ValidateResult> {
  return await invoke<ValidateResult>("plan_validate", { projectRoot, planPath });
}

export async function runNext(projectRoot: string, planPath: string, adapter: "codex" | "claude"): Promise<RunNextResult> {
  return await invoke<RunNextResult>("run_next", { projectRoot, planPath, adapter });
}

export async function resumeRun(
  projectRoot: string,
  planPath: string,
  runId: string,
  adapter: "codex" | "claude"
): Promise<RunNextResult> {
  return await invoke<RunNextResult>("resume_run", { projectRoot, planPath, runId, adapter });
}

export async function getEvidence(projectRoot: string, taskId: string): Promise<string[]> {
  return await invoke<string[]>("get_evidence", { projectRoot, taskId });
}

export async function projectGetGuidanceStatus(projectRoot: string): Promise<ProjectGuidanceStatus> {
  return await invoke<ProjectGuidanceStatus>("project_get_guidance_status", { projectRoot });
}

export async function packsListInstalled(): Promise<InstalledPack[]> {
  return await invoke<InstalledPack[]>("packs_list_installed");
}

export async function packsCheckUpdates(): Promise<PackUpdateStatus[]> {
  return await invoke<PackUpdateStatus[]>("packs_check_updates");
}

export async function packsDownload(packName: string, version?: string): Promise<InstalledPack> {
  return await invoke<InstalledPack>("packs_download", { packName, version });
}

export async function projectInstallGuidance(
  projectRoot: string,
  packPath: string,
  forceReplace: boolean
): Promise<unknown> {
  return await invoke<unknown>("project_install_guidance", { projectRoot, packPath, forceReplace });
}

export async function pauseRun(runId: string): Promise<boolean> {
  return await invoke<boolean>("pause_run", { runId });
}
