async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed: ${String(response.status)} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

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
  classification?: string;
  checksSummary?: string[];
  llmOutput?: string[];
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
  return await apiJson<ValidateResult>("/api/plan/validate", {
    method: "POST",
    body: JSON.stringify({ projectRoot, planPath })
  });
}

export function runNextStreamUrl(projectRoot: string, planPath: string, adapter: "codex" | "claude"): string {
  const url = new URL("/api/run/next/stream", window.location.origin);
  url.searchParams.set("projectRoot", projectRoot);
  url.searchParams.set("planPath", planPath);
  url.searchParams.set("adapter", adapter);
  return url.toString();
}

export async function runNextStreamInput(streamId: string, text: string): Promise<boolean> {
  return await apiJson<boolean>("/api/run/next/input", {
    method: "POST",
    body: JSON.stringify({ streamId, text })
  });
}

export async function runNextStreamCancel(streamId: string): Promise<boolean> {
  return await apiJson<boolean>("/api/run/next/cancel", {
    method: "POST",
    body: JSON.stringify({ streamId })
  });
}

export async function getEvidence(projectRoot: string, taskId: string): Promise<string[]> {
  const url = new URL("/api/evidence", window.location.origin);
  url.searchParams.set("projectRoot", projectRoot);
  url.searchParams.set("taskId", taskId);
  return await apiJson<string[]>(url.toString(), { method: "GET" });
}

export async function projectGetGuidanceStatus(projectRoot: string): Promise<ProjectGuidanceStatus> {
  const url = new URL("/api/project/guidance-status", window.location.origin);
  url.searchParams.set("projectRoot", projectRoot);
  return await apiJson<ProjectGuidanceStatus>(url.toString(), { method: "GET" });
}

export async function packsListInstalled(): Promise<InstalledPack[]> {
  return await apiJson<InstalledPack[]>("/api/packs/installed", { method: "GET" });
}

export async function packsCheckUpdates(): Promise<PackUpdateStatus[]> {
  return await apiJson<PackUpdateStatus[]>("/api/packs/updates", { method: "GET" });
}

export async function packsDownload(packName: string, version?: string): Promise<InstalledPack> {
  return await apiJson<InstalledPack>("/api/packs/download", {
    method: "POST",
    body: JSON.stringify({ packName, version })
  });
}

export async function projectInstallGuidance(
  projectRoot: string,
  packPath: string,
  forceReplace: boolean
): Promise<unknown> {
  return await apiJson<unknown>("/api/project/install-guidance", {
    method: "POST",
    body: JSON.stringify({ projectRoot, packPath, forceReplace })
  });
}

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
};

export type ProjectInitRequest = {
  parentDir: string;
  projectName: string;
  template?: string;
  skipGuidance?: boolean;
};

export type ProjectInitResult = {
  success: boolean;
  projectRoot?: string;
  message?: string;
};

export async function listTemplates(): Promise<ProjectTemplate[]> {
  return await apiJson<ProjectTemplate[]>("/api/templates", { method: "GET" });
}

export async function projectInit(request: ProjectInitRequest): Promise<ProjectInitResult> {
  return await apiJson<ProjectInitResult>("/api/project/init", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export async function getCwd(): Promise<string> {
  const result = await apiJson<{ cwd: string }>("/api/cwd", { method: "GET" });
  return result.cwd;
}

export async function selectFolder(): Promise<string | null> {
  const result = await apiJson<{ path: string | null }>("/api/dialog/select-folder", { method: "GET" });
  return result.path;
}

export type PlanFileEntry = { filename: string; path: string };
export type TaskStatus = { id: string; state: string };
export type PlanStatusResult = { tasks: TaskStatus[] };

export async function plansList(projectRoot: string): Promise<PlanFileEntry[]> {
  const url = new URL("/api/plans/list", window.location.origin);
  url.searchParams.set("projectRoot", projectRoot);
  return await apiJson<PlanFileEntry[]>(url.toString(), { method: "GET" });
}

export async function plansStatus(projectRoot: string, planPath: string): Promise<PlanStatusResult> {
  const url = new URL("/api/plans/status", window.location.origin);
  url.searchParams.set("projectRoot", projectRoot);
  url.searchParams.set("planPath", planPath);
  return await apiJson<PlanStatusResult>(url.toString(), { method: "GET" });
}
