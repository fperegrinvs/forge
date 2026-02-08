import { readFileSync } from "node:fs";
import { handleClaudeHookPayload } from "./hook-bridge.js";

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => null);
  if (!res || !res.ok) {
    // Best-effort: never block Claude Code on hook transport failures.
    return;
  }
}

async function main(): Promise<void> {
  const raw = readFileSync(0, "utf8");
  const payload = raw.trim() ? (JSON.parse(raw) as unknown) : {};
  const hookUrl = typeof process.env.FORGE_HOOK_URL === "string" ? process.env.FORGE_HOOK_URL : undefined;
  const result = handleClaudeHookPayload(payload, hookUrl ? { hookUrl } : {});

  if (result.post && result.post.url) {
    await postJson(result.post.url, result.post.body);
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
