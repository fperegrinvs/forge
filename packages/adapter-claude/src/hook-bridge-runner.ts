import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handleClaudeHookPayload } from "./hook-bridge.js";

export type HookBridgeRunnerDeps = {
  readStdin: () => string;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
};

export async function runHookBridgeRunner(deps: HookBridgeRunnerDeps): Promise<void> {
  const raw = deps.readStdin();
  const payload = raw.trim() ? (JSON.parse(raw) as unknown) : {};
  const hookUrl = typeof deps.env.FORGE_HOOK_URL === "string" ? deps.env.FORGE_HOOK_URL : undefined;
  const result = handleClaudeHookPayload(payload, hookUrl ? { hookUrl } : {});

  if (result.post && result.post.url) {
    const res = await deps.fetchImpl(result.post.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result.post.body)
    }).catch(() => null);
    if (!res || !res.ok) {
      // Best-effort: never block Claude Code on hook transport failures.
    }
  }

  if (result.stdout) {
    deps.stdout.write(result.stdout);
  }
}

async function main(): Promise<void> {
  await runHookBridgeRunner({
    readStdin: () => readFileSync(0, "utf8"),
    env: process.env,
    fetchImpl: fetch,
    stdout: process.stdout,
    stderr: process.stderr
  });
}

function isDirectInvocation(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return true;
  try {
    return pathToFileURL(argv1).href === import.meta.url || fileURLToPath(import.meta.url) === argv1;
  } catch {
    return true;
  }
}

if (isDirectInvocation()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
