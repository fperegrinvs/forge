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

export async function runNext(projectRoot: string, planPath: string, adapter: "codex" | "claude"): Promise<RunNextResult> {
  return await apiJson<RunNextResult>("/api/run/next", {
    method: "POST",
    body: JSON.stringify({ projectRoot, planPath, adapter })
  });
}

export async function resumeRun(
  projectRoot: string,
  planPath: string,
  runId: string,
  adapter: "codex" | "claude"
): Promise<RunNextResult> {
  return await apiJson<RunNextResult>("/api/run/resume", {
    method: "POST",
    body: JSON.stringify({ projectRoot, planPath, runId, adapter })
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

export async function pauseRun(runId: string): Promise<boolean> {
  return await apiJson<boolean>("/api/run/pause", {
    method: "POST",
    body: JSON.stringify({ runId })
  });
}
