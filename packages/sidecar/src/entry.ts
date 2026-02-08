import { runSidecarCommandWithCwd, parseSidecarCommand, sidecarExitCode, isStreamCommand } from "./sidecar.js";
import type { SidecarCommand } from "./index.js";

export async function readFirstLine(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let buffer = "";

  return await new Promise((resolve, reject) => {
    const onData = (chunk: string) => {
      buffer += chunk;
      const idx = buffer.indexOf("\n");
      if (idx === -1) return;

      const line = buffer.slice(0, idx);
      const rest = buffer.slice(idx + 1);

      // Preserve any additional buffered data for downstream consumers.
      process.stdin.off("data", onData);
      process.stdin.off("error", onErr);
      if (rest.length > 0) {
        process.stdin.unshift(rest);
      }
      resolve(line);
    };
    const onErr = (err: unknown) => {
      process.stdin.off("data", onData);
      process.stdin.off("error", onErr);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    process.stdin.on("data", onData);
    process.stdin.on("error", onErr);
    try {
      process.stdin.resume();
    } catch {
      // ignore
    }
  });
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function runEntryFromValue(
  parsed: unknown
): Promise<{ exitCode: number; result: unknown; command: SidecarCommand["command"] }> {
  const cmd = parseSidecarCommand(parsed);
  const result = await runSidecarCommandWithCwd(process.cwd(), cmd);
  const exitCode = sidecarExitCode(cmd.command, result);
  return { exitCode, result, command: cmd.command };
}

export async function runEntryFromLine(
  line: string
): Promise<{ exitCode: number; result: unknown; command: SidecarCommand["command"] }> {
  const trimmed = line.trim();
  if (!trimmed) {
    throw new Error("sidecar: missing start command on stdin");
  }
  const parsed = safeJsonParse(trimmed);
  if (!parsed) {
    throw new Error("sidecar: start command must be JSON");
  }
  return await runEntryFromValue(parsed);
}

export async function runEntryFromStdin(): Promise<void> {
  const line = await readFirstLine();
  const { exitCode, result, command } = await runEntryFromLine(line);
  if (!isStreamCommand(command) && result !== undefined) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  void runEntryFromStdin().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 3;
  });
}
