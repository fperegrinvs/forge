#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Command } from "commander";
import { ForgeControlPlane } from "@forge/control-plane";
import {
  getBundledGuidanceRoot,
  installGuidance,
  summarizeGuidanceDiff
} from "@forge/guidance-pack";
import { exists, listFilesRecursive } from "@forge/shared-utils";
import { initProject, scaffoldModule } from "@forge/templates";
import {
  formatMigrationSummary,
  formatWorkflowCheckSummary,
  migratePlanFile,
  runWorkflowCheck
} from "./workflow.js";

type JsonFlag = { json?: boolean };
type AdapterName = "codex" | "claude";

enum ExitCode {
  ValidationFailed = 2,
  RuntimeFailed = 3
}

function output(result: unknown, useJson?: boolean): void {
  if (useJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${String(result)}\n`);
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(ExitCode.RuntimeFailed);
}

function formatRunResult(result: {
  state: string;
  message: string;
  externalRunId?: string;
  resumeCommand?: string;
}): string {
  if (result.state !== "paused") {
    return result.message;
  }

  const lines = [result.message];
  if (result.externalRunId) {
    lines.push(`externalRunId: ${result.externalRunId}`);
  }
  if (result.resumeCommand) {
    lines.push(`manualResume: ${result.resumeCommand}`);
  }
  return lines.join("\n");
}

async function installGuidanceFromPath(sourceRoot: string, targetRoot: string): Promise<string[]> {
  const sourceFiles = await listFilesRecursive(sourceRoot);
  const installed: string[] = [];

  for (const file of sourceFiles) {
    const rel = relative(sourceRoot, file);
    const destination = join(targetRoot, rel);
    await mkdir(dirname(destination), { recursive: true });

    if (await exists(destination)) {
      continue;
    }

    const content = await readFile(file, "utf8");
    await writeFile(destination, content, "utf8");
    installed.push(rel);
  }

  return installed;
}

export function buildCli(): Command {
  const program = new Command();
  program.name("forge");

  program
    .command("init <project-name>")
    .option("--template <name>", "template identifier", "local")
    .option("--runtime <bun-version>", "bun version pin")
    .option("--ui <mode>", "ui mode", "vuetify")
    .option("--skip-guidance", "skip installing guidance pack")
    .option("--json", "machine output")
    .action(async (projectName: string, options: JsonFlag & { skipGuidance?: boolean }) => {
      try {
        const createdPath = await initProject(projectName, process.cwd());
        const guidanceResult = options.skipGuidance ? undefined : await installGuidance(createdPath);
        output(
          options.json
            ? {
                success: true,
                project: projectName,
                path: createdPath,
                guidance: guidanceResult
                  ? {
                      installed: guidanceResult.installed.length,
                      updated: guidanceResult.updated.length,
                      skipped: guidanceResult.skipped.length
                    }
                  : "skipped"
              }
            : `Initialized project at ${createdPath}${guidanceResult ? `\nGuidance installed: ${summarizeGuidanceDiff(guidanceResult)}` : "\nGuidance install skipped"}`,
          options.json
        );
      } catch (error) {
        fail(error);
      }
    });

  program
    .command("scaffold module <module-name>")
    .option("--with-contract-test", "create contract test", true)
    .option("--without-contract-test", "skip contract test")
    .option("--with-property-test", "create property test", true)
    .option("--without-property-test", "skip property test")
    .option("--json", "machine output")
    .action(async (moduleName: string, options: JsonFlag & Record<string, boolean>) => {
      try {
        const created = await scaffoldModule(moduleName, process.cwd(), {
          withContractTest: options.withContractTest ?? true,
          withPropertyTest: options.withPropertyTest ?? true
        });
        output(options.json ? { success: true, module: moduleName, files: created } : created.join("\n"), options.json);
      } catch (error) {
        fail(error);
      }
    });

  program
    .command("install-guidance")
    .option("--version <version>", "guidance version", "latest")
    .option("--source <source>", "source kind: registry|git|path", "registry")
    .option("--path <path>", "source path when --source path is used")
    .option("--json", "machine output")
    .action(async (options: JsonFlag & { source: string; path?: string }) => {
      try {
        if (options.source === "path") {
          if (!options.path) {
            throw new Error("--path is required when --source path is used");
          }

          const files = await installGuidanceFromPath(resolve(options.path), process.cwd());
          output(
            options.json
              ? { success: true, source: options.path, installed: files }
              : `Installed ${String(files.length)} files`,
            options.json
          );
          return;
        }

        const result = await installGuidance(process.cwd());
        output(
          options.json
            ? { success: true, source: getBundledGuidanceRoot(), result }
            : `Guidance installed: ${summarizeGuidanceDiff(result)}`,
          options.json
        );
      } catch (error) {
        fail(error);
      }
    });

  const plan = program.command("plan");

  plan
    .command("validate")
    .requiredOption("--file <path>", "plan path")
    .option("--json", "machine output")
    .action(async (options: JsonFlag & { file: string }) => {
      try {
        const controlPlane = new ForgeControlPlane(process.cwd());
        const result = await controlPlane.planValidate(resolve(options.file));
        if (!result.valid) {
          const hasLegacyIssue = result.issues.some((issue) => issue.code === "legacy_spec_version");
          const message = hasLegacyIssue
            ? "Plan invalid: legacy spec detected. Run 'forge plan migrate --file <path> --write'."
            : `Plan invalid (${String(result.issues.length)} issues)`;
          output(options.json ? result : message, options.json);
          process.exit(ExitCode.ValidationFailed);
        }

        output(options.json ? result : "Plan valid", options.json);
      } catch (error) {
        fail(error);
      }
    });

  plan
    .command("migrate")
    .requiredOption("--file <path>", "plan path")
    .option("--write", "write migrated plan to disk", false)
    .option("--json", "machine output")
    .action(async (options: JsonFlag & { file: string; write: boolean }) => {
      try {
        const result = await migratePlanFile(options.file, options.write);
        output(options.json ? result : formatMigrationSummary(result), options.json);
      } catch (error) {
        fail(error);
      }
    });

  const run = program.command("run");

  run
    .command("next")
    .requiredOption("--plan <path>", "plan path")
    .option("--adapter <name>", "codex|claude", "codex")
    .option("--json", "machine output")
    .action(async (options: JsonFlag & { plan: string; adapter: AdapterName }) => {
      try {
        const controlPlane = new ForgeControlPlane(process.cwd());
        const result = await controlPlane.runNext(resolve(options.plan), options.adapter);

        if (result.state === "failed") {
          output(options.json ? result : formatRunResult(result), options.json);
          process.exit(ExitCode.RuntimeFailed);
        }

        output(options.json ? result : formatRunResult(result), options.json);
      } catch (error) {
        fail(error);
      }
    });

  run
    .command("resume")
    .requiredOption("--plan <path>", "plan path")
    .requiredOption("--run-id <id>", "paused run id")
    .option("--adapter <name>", "codex|claude", "codex")
    .option("--json", "machine output")
    .action(async (options: JsonFlag & { plan: string; runId: string; adapter: AdapterName }) => {
      try {
        const controlPlane = new ForgeControlPlane(process.cwd());
        const resumed = await controlPlane.resume(options.runId);
        if (!resumed) {
          output(
            options.json
              ? { success: false, message: `Run ${options.runId} is not paused or does not exist.` }
              : `Run ${options.runId} is not paused or does not exist.`,
            options.json
          );
          process.exit(ExitCode.RuntimeFailed);
        }

        const result = await controlPlane.runNext(resolve(options.plan), options.adapter);
        if (result.state === "failed") {
          output(options.json ? result : formatRunResult(result), options.json);
          process.exit(ExitCode.RuntimeFailed);
        }

        output(options.json ? result : formatRunResult(result), options.json);
      } catch (error) {
        fail(error);
      }
    });

  const workflow = program.command("workflow");

  workflow
    .command("check")
    .requiredOption("--plan <path>", "plan path")
    .option("--base-ref <ref>", "git base ref for changed files")
    .option("--json", "machine output")
    .action(async (options: JsonFlag & { plan: string; baseRef?: string }) => {
      try {
        const result = await runWorkflowCheck(process.cwd(), resolve(options.plan), options.baseRef);
        if (!result.valid) {
          output(options.json ? result : formatWorkflowCheckSummary(result), options.json);
          process.exit(ExitCode.ValidationFailed);
        }

        output(options.json ? result : formatWorkflowCheckSummary(result), options.json);
      } catch (error) {
        fail(error);
      }
    });

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const cli = buildCli();
  await cli.parseAsync(argv);
}
