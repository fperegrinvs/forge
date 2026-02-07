import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exists, listFilesRecursive, readJsonFile, runCommand, writeJsonFile } from "./index.js";

describe("@forge/shared-utils", () => {
  it("writes and reads JSON files", async () => {
    // Given a temp directory and a JSON payload
    const root = await mkdtemp(join(tmpdir(), "forge-shared-utils-"));
    const path = join(root, "nested", "value.json");
    const payload = { ok: true, value: 42 };

    // When the payload is written then read
    await writeJsonFile(path, payload);
    const read = await readJsonFile<typeof payload>(path);

    // Then it round-trips correctly
    expect(read).toEqual(payload);
  });

  it("checks file existence", async () => {
    // Given an existing file and a missing file
    const root = await mkdtemp(join(tmpdir(), "forge-shared-utils-"));
    const present = join(root, "present.txt");
    const missing = join(root, "missing.txt");
    await writeFile(present, "ok", "utf8");

    // When existence is checked
    const presentResult = await exists(present);
    const missingResult = await exists(missing);

    // Then it returns true for present and false for missing
    expect(presentResult).toBe(true);
    expect(missingResult).toBe(false);
  });

  it("lists files recursively", async () => {
    // Given a directory tree with nested files
    const root = await mkdtemp(join(tmpdir(), "forge-shared-utils-"));
    const a = join(root, "a.txt");
    const b = join(root, "nested", "b.txt");
    await writeFile(a, "a", "utf8");
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(b, "b", "utf8");

    // When files are listed recursively
    const files = await listFilesRecursive(root);

    // Then all files are returned
    expect(new Set(files)).toEqual(new Set([a, b]));
  });

  it("runs a command and captures stdout/stderr/exit code", async () => {
    // Given a node process that prints to stdout and stderr and exits non-zero
    const script = [
      'console.log("stdout-line");',
      'console.error("stderr-line");',
      "process.exit(5);"
    ].join("");

    // When runCommand executes it
    const result = await runCommand(process.execPath, ["-e", script], process.cwd());

    // Then outputs and exit code are captured
    expect(result.exitCode).toBe(5);
    expect(result.stdout).toContain("stdout-line");
    expect(result.stderr).toContain("stderr-line");
  });
});
