import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliExit, buildCli } from "./cli.js";
import "./index.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "..", "..", "..");

type CapturedStdio = {
  stdout: string;
  stderr: string;
  error?: unknown;
};

async function captureStdio(run: () => Promise<void>): Promise<CapturedStdio> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as unknown as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as unknown as typeof process.stderr.write;

  try {
    await run();
    return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
  } catch (error) {
    return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join(""), error };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
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
      const { stdout } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "init", "my-app", "--skip-guidance", "--json"]);
      });

      // Then the output is valid JSON describing the created project
      const parsed = JSON.parse(stdout) as { success: boolean; path: string; guidance: unknown };
      expect(parsed.success).toBe(true);
      expect(parsed.path).toContain("my-app");
      expect(parsed.guidance).toBe("skipped");
    } finally {
      process.chdir(previous);
    }
  });

  it("runs scaffold module and emits created file list", async () => {
    // Given a temp working directory
    const root = await mkdtemp(join(tmpdir(), "forge-cli-"));
    const previous = process.cwd();
    process.chdir(root);

    try {
      // When the scaffold command is executed
      const { stdout } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "scaffold", "module", "starter"]);
      });

      // Then the output includes created file paths
      expect(stdout).toContain("modules/starter/routes.ts");
    } finally {
      process.chdir(previous);
    }
  });

  it("installs guidance from a local path and emits JSON", async () => {
    // Given a guidance source directory and a target directory
    const source = await mkdtemp(join(tmpdir(), "forge-guidance-src-"));
    const target = await mkdtemp(join(tmpdir(), "forge-guidance-dst-"));
    await mkdir(join(source, "rules"), { recursive: true });
    await writeFile(join(source, "rules", "example.md"), "ok\n", "utf8");

    const previous = process.cwd();
    process.chdir(target);

    try {
      // When install-guidance is executed with --source path
      const { stdout } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync([
          "node",
          "forge",
          "install-guidance",
          "--source",
          "path",
          "--path",
          source,
          "--json"
        ]);
      });

      // Then it reports installed files
      const parsed = JSON.parse(stdout) as {
        success: boolean;
        source: string;
        result: { installed: string[]; updated: string[]; skipped: string[] };
      };
      expect(parsed.success).toBe(true);
      expect(parsed.source).toBeTruthy();
      expect(parsed.result.installed).toContain("rules/example.md");
    } finally {
      process.chdir(previous);
    }
  });

  it("fails install-guidance when --source path is used without --path", async () => {
    const { stderr, error } = await captureStdio(async () => {
      const cli = buildCli();
      await cli.parseAsync(["node", "forge", "install-guidance", "--source", "path"]);
    });

    expect(error).toBeInstanceOf(CliExit);
    expect((error as CliExit).code).toBe(3);
    expect(stderr).toContain("--path is required when --source path is used");
  });

  it("installs bundled guidance and emits JSON", async () => {
    const target = await mkdtemp(join(tmpdir(), "forge-guidance-bundled-"));
    const previous = process.cwd();
    process.chdir(target);

    try {
      const { stdout } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "install-guidance", "--json"]);
      });

      const parsed = JSON.parse(stdout) as { success: boolean; source: string; result: unknown };
      expect(parsed.success).toBe(true);
      expect(parsed.source).toBeTruthy();
      expect(parsed.result).toBeTruthy();
    } finally {
      process.chdir(previous);
    }
  });

  it("validates the repo plan file and emits JSON", async () => {
    // Given the repo root and a known-valid plan file
    const previous = process.cwd();
    process.chdir(repoRoot);

    try {
      // When plan validate runs with --json
      const { stdout } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync([
          "node",
          "forge",
          "plan",
          "validate",
          "--file",
          "plans/forge-monorepo-v1.plan.json",
          "--json"
        ]);
      });

      // Then it returns a valid result
      const parsed = JSON.parse(stdout) as { valid: boolean };
      expect(parsed.valid).toBe(true);
    } finally {
      process.chdir(previous);
    }
  });

  it("prints a legacy spec hint when plan validation fails with legacy spec version", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-cli-"));
    const planFile = join(root, "legacy.plan.json");
    await writeFile(planFile, JSON.stringify({ metadata: { spec_version: "v1" } }, null, 2), "utf8");

    const previous = process.cwd();
    process.chdir(root);
    try {
      const { stdout, error } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "plan", "validate", "--file", planFile]);
      });

      expect(error).toBeInstanceOf(CliExit);
      expect((error as CliExit).code).toBe(2);
      expect(stdout).toContain("legacy spec detected");
      expect(stdout).toContain("forge plan migrate");
    } finally {
      process.chdir(previous);
    }
  });

  it("migrates a legacy plan and emits JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-cli-"));
    const planFile = join(root, "legacy-migrate.plan.json");
    const now = new Date().toISOString();

    const legacyPlan = {
      metadata: {
        project: "forge-test",
        created: now,
        last_updated: now,
        spec_version: "v1",
        approved: true
      },
      context: {
        goals: ["test coverage"],
        constraints: [],
        tech_decisions: {},
        architecture: "modulith"
      },
      tasks: [
        {
          id: "docs-1",
          task_type: "documentation",
          name: "Docs",
          description: "Test plan migration",
          files: [],
          dependencies: [],
          acceptance_criteria: ["Migration succeeds"],
          verification_command: "true"
        }
      ]
    };

    await writeFile(planFile, `${JSON.stringify(legacyPlan, null, 2)}\n`, "utf8");

    const previous = process.cwd();
    process.chdir(root);
    try {
      const { stdout } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "plan", "migrate", "--file", planFile, "--json"]);
      });

      const parsed = JSON.parse(stdout) as { migrated: boolean; wrote: boolean; fromSpecVersion?: string; toSpecVersion: string };
      expect(parsed.migrated).toBe(true);
      expect(parsed.wrote).toBe(false);
      expect(parsed.fromSpecVersion).toBe("v1");
      expect(parsed.toSpecVersion).toBe("v2");
    } finally {
      process.chdir(previous);
    }
  });

  it("auto-resumes paused run when run next is called", async () => {
    // Given a workspace where the only task is already completed but a stale pausedRun exists
    const root = await mkdtemp(join(tmpdir(), "forge-run-"));
    await mkdir(join(root, "checks", "task-types", "documentation"), { recursive: true });
    await mkdir(join(root, ".forge"), { recursive: true });

    const now = new Date().toISOString();
    const plan = {
      metadata: {
        project: "forge-test",
        created: now,
        last_updated: now,
        spec_version: "v2",
        approved: true
      },
      context: {
        goals: ["exercise run next"],
        constraints: [],
        tech_decisions: {},
        architecture: "modulith"
      },
      tasks: [
        {
          id: "docs-1",
          task_type: "documentation",
          name: "Docs",
          description: "A no-op docs task",
          files: [],
          dependencies: [],
          acceptance_criteria: ["ok"],
          verification_command: "true",
          tests: {
            bdd_scenarios: [],
            property_invariants: [],
            contract_tests: []
          },
          documentation: {
            updates: [],
            decision_notes: ""
          }
        }
      ]
    };

    const planPath = join(root, "plan.json");
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    // State has a pausedRun but the task is already completed
    // Previously runNext would refuse to proceed; now it should auto-resume and see no pending tasks
    const state = {
      planPath,
      tasks: { "docs-1": "completed" },
      pausedRun: {
        runId: "run-1",
        adapterType: "codex",
        externalRunId: "ext-1"
      },
      pausedRunId: "run-1"
    };
    await writeFile(join(root, ".forge", "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const previous = process.cwd();
    process.chdir(root);
    try {
      // When run next is called on a workspace with a stale paused run
      const { stdout } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "run", "next", "--plan", planPath, "--json"]);
      });

      // Then it auto-resumes (clears pausedRun) and reports no runnable tasks
      const parsed = JSON.parse(stdout) as { state: string; message: string };
      expect(parsed.state).toBe("completed");
      expect(parsed.message).toContain("No runnable tasks remain");
    } finally {
      process.chdir(previous);
    }
  });

  it("reports failure when run resume is called with a non-paused run id", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-run-"));
    await mkdir(join(root, "checks", "task-types", "documentation"), { recursive: true });
    await mkdir(join(root, ".forge"), { recursive: true });

    const now = new Date().toISOString();
    const plan = {
      metadata: {
        project: "forge-test",
        created: now,
        last_updated: now,
        spec_version: "v2",
        approved: true
      },
      context: {
        goals: ["exercise run resume"],
        constraints: [],
        tech_decisions: {},
        architecture: "modulith"
      },
      tasks: [
        {
          id: "docs-1",
          task_type: "documentation",
          name: "Docs",
          description: "A no-op docs task",
          files: [],
          dependencies: [],
          acceptance_criteria: ["ok"],
          verification_command: "true",
          tests: {
            bdd_scenarios: [],
            property_invariants: [],
            contract_tests: []
          },
          documentation: {
            updates: [],
            decision_notes: ""
          }
        }
      ]
    };

    const planPath = join(root, "plan.json");
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    const state = {
      planPath,
      tasks: { "docs-1": "pending" },
      pausedRunId: "run-1"
    };
    await writeFile(join(root, ".forge", "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const previous = process.cwd();
    process.chdir(root);
    try {
      const { stdout, error } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync([
          "node",
          "forge",
          "run",
          "resume",
          "--plan",
          planPath,
          "--run-id",
          "not-paused",
          "--json"
        ]);
      });

      expect(error).toBeInstanceOf(CliExit);
      expect((error as CliExit).code).toBe(3);
      const parsed = JSON.parse(stdout) as { success: boolean; message: string };
      expect(parsed.success).toBe(false);
      expect(parsed.message).toContain("not paused");
    } finally {
      process.chdir(previous);
    }
  });

  it("does not overwrite existing files when installing guidance from a local path", async () => {
    const source = await mkdtemp(join(tmpdir(), "forge-guidance-src-"));
    const target = await mkdtemp(join(tmpdir(), "forge-guidance-dst-"));
    await mkdir(join(source, "rules"), { recursive: true });
    await writeFile(join(source, "rules", "example.md"), "from-source\n", "utf8");

    await mkdir(join(target, "rules"), { recursive: true });
    await writeFile(join(target, "rules", "example.md"), "existing\n", "utf8");

    const previous = process.cwd();
    process.chdir(target);

    try {
      const { stdout } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync([
          "node",
          "forge",
          "install-guidance",
          "--source",
          "path",
          "--path",
          source,
          "--json"
        ]);
      });

      const parsed = JSON.parse(stdout) as {
        success: boolean;
        result: { installed: string[]; updated: string[]; skipped: string[] };
      };
      expect(parsed.success).toBe(true);
      expect(parsed.result.installed).not.toContain("rules/example.md");

      const content = await readFile(join(target, "rules", "example.md"), "utf8");
      expect(content).toBe("existing\n");
    } finally {
      process.chdir(previous);
    }
  });

  it("prints Plan valid for a valid plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-plan-"));
    await mkdir(join(root, "checks", "task-types", "documentation"), { recursive: true });

    const now = new Date().toISOString();
    const plan = {
      metadata: {
        project: "forge-test",
        created: now,
        last_updated: now,
        spec_version: "v2",
        approved: true
      },
      context: {
        goals: ["exercise plan validate"],
        constraints: [],
        tech_decisions: {},
        architecture: "modulith"
      },
      tasks: [
        {
          id: "docs-1",
          task_type: "documentation",
          name: "Docs",
          description: "A no-op docs task",
          files: [],
          dependencies: [],
          acceptance_criteria: ["ok"],
          verification_command: "true",
          tests: {
            bdd_scenarios: [],
            property_invariants: [],
            contract_tests: []
          },
          documentation: {
            updates: [],
            decision_notes: ""
          }
        }
      ]
    };

    const planPath = join(root, "plan.json");
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    const previous = process.cwd();
    process.chdir(root);
    try {
      const { stdout, error } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "plan", "validate", "--file", planPath]);
      });

      expect(error).toBeUndefined();
      expect(stdout.trim()).toBe("Plan valid");
    } finally {
      process.chdir(previous);
    }
  });

  it("prints an issue summary for invalid plans that are not legacy", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-plan-"));
    const planPath = join(root, "invalid.plan.json");
    await writeFile(planPath, `${JSON.stringify({ metadata: { spec_version: "v2" } }, null, 2)}\n`, "utf8");

    const previous = process.cwd();
    process.chdir(root);
    try {
      const { stdout, error } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "plan", "validate", "--file", planPath]);
      });

      expect(error).toBeInstanceOf(CliExit);
      expect((error as CliExit).code).toBe(2);
      expect(stdout).toContain("Plan invalid (");
      expect(stdout).not.toContain("legacy spec detected");
    } finally {
      process.chdir(previous);
    }
  });

  it("prints migration summaries with and without --write", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-cli-"));
    const planFile = join(root, "legacy-migrate.plan.json");
    const now = new Date().toISOString();

    const legacyPlan = {
      metadata: {
        project: "forge-test",
        created: now,
        last_updated: now,
        spec_version: "v1",
        approved: true
      },
      context: {
        goals: ["exercise migrate summaries"],
        constraints: [],
        tech_decisions: {},
        architecture: "modulith"
      },
      tasks: [
        {
          id: "docs-1",
          task_type: "documentation",
          name: "Docs",
          description: "A no-op docs task",
          files: [],
          dependencies: [],
          acceptance_criteria: ["ok"],
          verification_command: "true"
        }
      ]
    };

    await writeFile(planFile, `${JSON.stringify(legacyPlan, null, 2)}\n`, "utf8");

    const previous = process.cwd();
    process.chdir(root);
    try {
      const { stdout: dryRun } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "plan", "migrate", "--file", planFile]);
      });
      expect(dryRun).toContain("rerun with --write");

      const { stdout: wrote } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "plan", "migrate", "--file", planFile, "--write"]);
      });
      expect(wrote).toContain("Migrated");
      expect(wrote).toContain("to v2");
    } finally {
      process.chdir(previous);
    }
  });

  it("exits with runtime failure when run next cannot validate the plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-run-"));
    const planPath = join(root, "invalid.plan.json");
    await writeFile(planPath, `${JSON.stringify({ metadata: { spec_version: "v1" } }, null, 2)}\n`, "utf8");

    const previous = process.cwd();
    process.chdir(root);
    try {
      const { stdout, error } = await captureStdio(async () => {
        const cli = buildCli();
        await cli.parseAsync(["node", "forge", "run", "next", "--plan", planPath, "--json"]);
      });

      expect(error).toBeInstanceOf(CliExit);
      expect((error as CliExit).code).toBe(3);
      const parsed = JSON.parse(stdout) as { state: string; message: string };
      expect(parsed.state).toBe("failed");
      expect(parsed.message).toContain("validation failed");
    } finally {
      process.chdir(previous);
    }
  });
});
