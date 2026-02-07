import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCli } from "./cli.js";

function captureStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as unknown as typeof process.stdout.write;

  return run()
    .then(() => chunks.join(""))
    .finally(() => {
      process.stdout.write = originalWrite;
    });
}

describe("cli", () => {
  it("builds command tree", () => {
    // Given the CLI builder
    const cli = buildCli();

    // When the command tree is inspected
    const names = cli.commands.map((command) => command.name());

    // Then expected top-level commands exist
    expect(names).toContain("init");
    expect(names).toContain("scaffold");
    expect(names).toContain("install-guidance");
    expect(names).toContain("plan");
    expect(names).toContain("run");
    expect(names).toContain("workflow");

    const run = cli.commands.find((command) => command.name() === "run");
    const runCommands = run?.commands.map((command) => command.name()) ?? [];
    expect(runCommands).toContain("next");
    expect(runCommands).toContain("resume");
  });

  it("runs init with --skip-guidance and emits JSON", async () => {
    // Given a temp working directory
    const root = await mkdtemp(join(tmpdir(), "forge-cli-"));
    const previous = process.cwd();
    process.chdir(root);

    try {
      // When the init command is executed
      const output = await captureStdout(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "init", "my-app", "--skip-guidance", "--json"]);
      });

      // Then the output is valid JSON describing the created project
      const parsed = JSON.parse(output) as { success: boolean; path: string; guidance: unknown };
      expect(parsed.success).toBe(true);
      expect(parsed.path).toContain("my-app");
      expect(parsed.guidance).toBe("skipped");
    } finally {
      process.chdir(previous);
    }
  });

  it("runs scaffold module and emits JSON with created files", async () => {
    // Given a temp working directory
    const root = await mkdtemp(join(tmpdir(), "forge-cli-"));
    const previous = process.cwd();
    process.chdir(root);

    try {
      // When the scaffold command is executed
      const output = await captureStdout(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "scaffold", "module", "starter", "--json"]);
      });

      // Then the output includes a list of created files
      const parsed = JSON.parse(output) as { success: boolean; files: string[] };
      expect(parsed.success).toBe(true);
      expect(parsed.files.length).toBeGreaterThan(0);
      expect(parsed.files.some((file) => file.includes("modules/starter/routes.ts"))).toBe(true);
    } finally {
      process.chdir(previous);
    }
  });
});

