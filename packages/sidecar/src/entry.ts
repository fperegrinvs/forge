import { runSidecarCommand, parseSidecarCommand, sidecarExitCode, isStreamCommand } from "./sidecar.js";

async function readFirstLine(): Promise<string> {
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

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const line = (await readFirstLine()).trim();
  if (!line) {
    throw new Error("sidecar: missing start command on stdin");
  }
  const parsed = safeJsonParse(line);
  if (!parsed) {
    throw new Error("sidecar: start command must be JSON");
  }

  const cmd = parseSidecarCommand(parsed);
  const result = await runSidecarCommand(cmd);
  if (!isStreamCommand(cmd.command) && result !== undefined) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  process.exitCode = sidecarExitCode(cmd.command, result);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 3;
});
