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

export type SpawnConfig = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
};

export type SpawnResult = {
  sessionId: string;
};

export async function terminalSpawn(config: SpawnConfig): Promise<SpawnResult> {
  return await apiJson<SpawnResult>("/api/terminal/spawn", {
    method: "POST",
    body: JSON.stringify(config)
  });
}

export async function terminalKill(sessionId: string): Promise<boolean> {
  return await apiJson<boolean>(`/api/terminal/${sessionId}`, {
    method: "DELETE"
  });
}

export async function terminalResize(sessionId: string, cols: number, rows: number): Promise<boolean> {
  return await apiJson<boolean>(`/api/terminal/${sessionId}/resize`, {
    method: "POST",
    body: JSON.stringify({ cols, rows })
  });
}

export function terminalWsUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/terminal/${sessionId}/ws`;
}
