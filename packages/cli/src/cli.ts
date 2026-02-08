#!/usr/bin/env node
import { join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Command } from "commander";
import { ForgeControlPlane, ForgeWorkflowRunner, renderWorkflowProgress } from "@forge/control-plane";
import { CodexAppServerAdapter } from "@forge/adapter-codex";
import { ClaudePtyAdapter } from "@forge/adapter-claude";
import { exists, readJsonFile, runCommand } from "@forge/shared-utils";
import {
  getBundledGuidanceRoot,
  installGuidance,
  installGuidanceFromPackRoot,
  registerCodexSkills,
  summarizeGuidanceDiff
} from "@forge/guidance-pack";
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

export class CliExit extends Error {
  constructor(readonly code: ExitCode) {
    super(`CLI exited with code ${String(code)}`);
    this.name = "CliExit";
  }
}

function exit(code: ExitCode): never {
  throw new CliExit(code);
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
  exit(ExitCode.RuntimeFailed);
}

type ProjectGuidanceSource = {
  installedAt: string;
  pack: { name: string; version: string; path: string };
  forceReplace: boolean;
  installer: "forge-cli";
};

async function readPackManifest(packRoot: string): Promise<{ name: string; version: string } | undefined> {
  try {
    const raw = await readFile(join(packRoot, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
    const name = typeof parsed.name === "string" ? parsed.name : "";
    const version = typeof parsed.version === "string" ? parsed.version : "";
    if (!name || !version) return undefined;
    return { name, version };
  } catch {
    return undefined;
  }
}

async function writeGuidanceSourceFile(targetRoot: string, value: ProjectGuidanceSource): Promise<void> {
  // Best-effort metadata; never fail the command on write issues.
  try {
    await mkdir(join(targetRoot, ".forge"), { recursive: true });
    await writeFile(join(targetRoot, ".forge", "guidance.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch {
    // ignore
  }
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
        if (guidanceResult) {
          const bundledRoot = getBundledGuidanceRoot();
          const manifest = await readPackManifest(bundledRoot);
          if (manifest) {
            await writeGuidanceSourceFile(createdPath, {
              installedAt: new Date().toISOString(),
              pack: { ...manifest, path: bundledRoot },
              forceReplace: false,
              installer: "forge-cli"
            });
          }
        }
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
        if (error instanceof CliExit) {
          throw error;
        }
        fail(error);
      }
    });

  const scaffold = program.command("scaffold");

  scaffold
    .command("module <module-name>")
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
        if (error instanceof CliExit) {
          throw error;
        }
        fail(error);
      }
    });

  program
    .command("install-guidance")
    .option("--version <version>", "guidance version", "latest")
    .option("--source <source>", "source kind: registry|git|path", "registry")
    .option("--path <path>", "source path when --source path is used")
    .option("--force-replace", "replace local changes with guidance pack contents", false)
    .option("--json", "machine output")
    .action(async (options: JsonFlag & { source: string; path?: string; forceReplace?: boolean }) => {
      try {
        if (options.source === "path") {
          if (!options.path) {
            throw new Error("--path is required when --source path is used");
          }

          const sourcePath = resolve(options.path);
          const result = await installGuidanceFromPackRoot(sourcePath, process.cwd(), {
            forceReplace: options.forceReplace ?? false
          });
          const manifest = await readPackManifest(sourcePath);
          if (manifest) {
            await writeGuidanceSourceFile(process.cwd(), {
              installedAt: new Date().toISOString(),
              pack: { ...manifest, path: sourcePath },
              forceReplace: options.forceReplace ?? false,
              installer: "forge-cli"
            });
          }
          output(
            options.json
              ? { success: true, source: sourcePath, result }
              : `Guidance installed: ${summarizeGuidanceDiff(result)}`,
            options.json
          );
          return;
        }

        const result = await installGuidance(process.cwd(), { forceReplace: options.forceReplace ?? false });
        const bundledRoot = getBundledGuidanceRoot();
        const manifest = await readPackManifest(bundledRoot);
        if (manifest) {
          await writeGuidanceSourceFile(process.cwd(), {
            installedAt: new Date().toISOString(),
            pack: { ...manifest, path: bundledRoot },
            forceReplace: options.forceReplace ?? false,
            installer: "forge-cli"
          });
        }
        output(
          options.json
            ? { success: true, source: getBundledGuidanceRoot(), result }
            : `Guidance installed: ${summarizeGuidanceDiff(result)}`,
          options.json
        );
      } catch (error) {
        if (error instanceof CliExit) {
          throw error;
        }
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
          exit(ExitCode.ValidationFailed);
        }

        output(options.json ? result : "Plan valid", options.json);
      } catch (error) {
        if (error instanceof CliExit) {
          throw error;
        }
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
        if (error instanceof CliExit) {
          throw error;
        }
        fail(error);
      }
    });

  const run = program.command("run");

  run
    .command("next")
    .requiredOption("--plan <path>", "plan path")
    .option("--adapter <name>", "codex|claude", "codex")
    .option("--json", "machine output")
    .option("--jsonl", "stream JSONL events to stdout", false)
    .action(async (options: JsonFlag & { jsonl?: boolean; plan: string; adapter: AdapterName }) => {
      try {
        const controlPlane = new ForgeControlPlane(process.cwd());
        if (options.jsonl) {
          const writeLine = (value: unknown) => {
            process.stdout.write(`${JSON.stringify(value)}\n`);
          };

          writeLine({
            type: "run.next.started",
            plan: resolve(options.plan),
            adapter: options.adapter,
            at: new Date().toISOString()
          });

          if (options.adapter === "codex") {
            try {
              const skillsDir = join(process.cwd(), "skills");
              const preflight = await registerCodexSkills(skillsDir, process.cwd());
              writeLine({
                type: "preflight.codex_skills",
                updated: preflight.updated,
                at: new Date().toISOString()
              });
            } catch (error) {
              writeLine({
                type: "preflight.codex_skills.error",
                message: String(error),
                at: new Date().toISOString()
              });
            }
          }

          const result = await controlPlane.runNext(resolve(options.plan), options.adapter, undefined, {
            onAdapterEvent: (event) => {
              writeLine({ type: "adapter.event", event });
            }
          });

          writeLine({ type: "run.next.result", result });
          if (result.state === "failed") {
            exit(ExitCode.RuntimeFailed);
          }
          return;
        }

        if (options.adapter === "codex") {
          try {
            const skillsDir = join(process.cwd(), "skills");
            await registerCodexSkills(skillsDir, process.cwd());
          } catch (error) {
            process.stderr.write(`[warn] codex skills preflight failed: ${String(error)}\n`);
          }
        }

        const result = await controlPlane.runNext(resolve(options.plan), options.adapter);

        if (result.state === "failed") {
          output(options.json ? result : formatRunResult(result), options.json);
          exit(ExitCode.RuntimeFailed);
        }

        output(options.json ? result : formatRunResult(result), options.json);
      } catch (error) {
        if (error instanceof CliExit) {
          throw error;
        }
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
          exit(ExitCode.RuntimeFailed);
        }

        const result = await controlPlane.runNext(resolve(options.plan), options.adapter);
        if (result.state === "failed") {
          output(options.json ? result : formatRunResult(result), options.json);
          exit(ExitCode.RuntimeFailed);
        }

        output(options.json ? result : formatRunResult(result), options.json);
      } catch (error) {
        if (error instanceof CliExit) {
          throw error;
        }
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
          exit(ExitCode.ValidationFailed);
        }

        output(options.json ? result : formatWorkflowCheckSummary(result), options.json);
      } catch (error) {
        if (error instanceof CliExit) {
          throw error;
        }
        fail(error);
      }
    });

  workflow
    .command("auto")
    .requiredOption("--plan <path>", "plan path")
    .option("--adapter <name>", "codex|claude", "codex")
    .option("--max-retries <n>", "max retries per phase", "3")
    .option("--push", "push after each completed task", true)
    .option("--no-push", "disable pushing")
    .option("--remote <name>", "git remote name", "origin")
    .option("--dry-run", "do not run agents/gates/git; only simulate plan status updates", false)
    .option("--json", "machine output")
    .option("--jsonl", "stream JSONL events to stdout", false)
    .action(async (options: JsonFlag & { jsonl?: boolean; plan: string; adapter: AdapterName; maxRetries: string; push: boolean; remote: string; dryRun?: boolean }) => {
      try {
        const workspaceRoot = process.cwd();
        const planPath = resolve(options.plan);
        const maxRetries = Number.parseInt(options.maxRetries, 10);
        if (!Number.isFinite(maxRetries) || maxRetries < 1) {
          throw new Error("--max-retries must be a positive integer");
        }

        const writeLine = (value: unknown) => {
          process.stdout.write(`${JSON.stringify(value)}\n`);
        };

        const codexAdapter = options.dryRun ? null : new CodexAppServerAdapter();
        const claudeAdapter = options.dryRun ? null : new ClaudePtyAdapter();

        const runner = new ForgeWorkflowRunner(
          workspaceRoot,
          (type) => {
            if (options.dryRun) {
              const startRun = () => Promise.resolve({ runId: "dry-run" });
              const streamEvents = async function* (runId: string) {
	                // Keep the generator async to match the adapter interface contract.
	                await Promise.resolve();
	                yield { type: "run.started", runId, at: new Date().toISOString() } as const;
	                yield { type: "run.completed", runId, exitCode: 0, at: new Date().toISOString() } as const;
	              };
	              const resume = (runId: string) => Promise.resolve({ runId });
	              const cancel = () => Promise.resolve();
	              return {
	                startRun,
	                streamEvents,
	                resume,
                cancel
              };
            }
            if (type === "codex") {
              if (!codexAdapter) throw new Error("codex adapter unavailable");
              return codexAdapter;
            }
            if (!claudeAdapter) throw new Error("claude adapter unavailable");
            return claudeAdapter;
          },
          {
            onAdapterEvent: (event) => {
              if (options.jsonl) {
                writeLine({ type: "adapter.event", event });
                return;
              }
              if (options.json || options.dryRun) return;
              if (event.type === "run.output") process.stderr.write(event.chunk);
            },
            gateRunner: async (phase: string, cwd: string) => {
              if (options.dryRun) {
                return { ok: true, stdout: "dry-run", stderr: "", exitCode: 0 };
              }
              // Phase gates are simple scripts; run via bash so executable bits are not required.
              const scriptPath = await resolvePhaseGateScript(workspaceRoot, phase);
              const result = await runCommand("bash", [scriptPath], cwd);
              return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
            },
            git: {
              async currentBranch() {
                if (options.dryRun) return "codex/dry-run";
                const res = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], workspaceRoot);
                return res.stdout.trim();
              },
              async commit(message: string) {
                if (options.dryRun) return;
                await runCommand("git", ["add", "-A"], workspaceRoot);
                const res = await runCommand("git", ["commit", "-m", message], workspaceRoot);
                if (res.exitCode !== 0) {
                  throw new Error(res.stderr || res.stdout || "git commit failed");
                }
              },
              async push(remote: string) {
                if (options.dryRun) return;
                const branchRes = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], workspaceRoot);
                const branch = branchRes.stdout.trim();
                const res = await runCommand("git", ["push", "-u", remote, branch], workspaceRoot);
                if (res.exitCode !== 0) {
                  throw new Error(res.stderr || res.stdout || "git push failed");
                }
              }
            }
          }
        );

        if (options.jsonl) {
          writeLine({
            type: "workflow.auto.started",
            plan: planPath,
            adapter: options.adapter,
            at: new Date().toISOString()
          });
        }

        // Loop until plan is fully completed or the workflow pauses.
        // Keep a hard cap to avoid infinite loops on buggy status transitions.
        const maxSteps = 5000;
        for (let i = 0; i < maxSteps; i += 1) {
          const step = await runner.runAuto(planPath, options.adapter, {
            maxRetries,
            push: options.push && !options.dryRun,
            remote: options.remote
          });

          if (step.state === "running") {
            if (options.jsonl) {
              writeLine({ type: "workflow.auto.step", taskId: step.taskId, phase: step.phase, at: new Date().toISOString() });
              continue;
            }
            if (!options.json && !options.dryRun) {
              try {
                const raw = await readFile(planPath, "utf8");
                const plan = JSON.parse(raw) as {
                  tasks: Array<{
                    id: string;
                    task_type: string;
                    name: string;
                    description: string;
                    dependencies: string[];
                    status?: "" | "spec" | "implement" | "refactor" | "document" | "completed";
                  }>;
                };
                process.stderr.write(renderWorkflowProgress(plan));
                process.stderr.write(`Last step: ${step.taskId} phase=${step.phase}\n`);
              } catch {
                // ignore (best-effort UX)
              }
            }
            continue;
          }

          if (options.jsonl) {
            writeLine({ type: `workflow.auto.${step.state}`, step, at: new Date().toISOString() });
            return;
          }

          if (!options.json && !options.dryRun) {
            try {
              const raw = await readFile(planPath, "utf8");
              const plan = JSON.parse(raw) as {
                tasks: Array<{
                  id: string;
                  task_type: string;
                  name: string;
                  description: string;
                  dependencies: string[];
                  status?: "" | "spec" | "implement" | "refactor" | "document" | "completed";
                }>;
              };
              process.stderr.write(renderWorkflowProgress(plan));
            } catch {
              // ignore (best-effort UX)
            }
          }
          output(options.json ? step : step.message, options.json);
          return;
        }

        throw new Error("workflow auto aborted: exceeded max steps");
      } catch (error) {
        if (error instanceof CliExit) {
          throw error;
        }
        fail(error);
      }
    });

  const codex = program.command("codex");

  codex
    .command("session")
    .option("--jsonl", "stream JSONL events to stdout", true)
    .option("--auto-skill <name>", "auto-run a Codex skill invocation before reading stdin")
    .action(async (options: { jsonl?: boolean; autoSkill?: string }) => {
      try {
        const adapter = new CodexAppServerAdapter();
        const writeLine = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

        writeLine({ type: "codex.session.started", at: new Date().toISOString() });

        const baseRunContext = {
          taskId: "codex-session",
          workingDirectory: process.cwd(),
          allowedTools: [] as string[],
          approvalMode: process.stdin.isTTY ? ("suggest" as const) : ("full-auto" as const)
        };

        try {
          const skillsDir = join(process.cwd(), "skills");
          const preflight = await registerCodexSkills(skillsDir, process.cwd());
          writeLine({
            type: "preflight.codex_skills",
            updated: preflight.updated,
            at: new Date().toISOString()
          });
        } catch (error) {
          writeLine({
            type: "preflight.codex_skills.error",
            message: String(error),
            at: new Date().toISOString()
          });
        }

        if (typeof options.autoSkill === "string" && options.autoSkill.trim()) {
          const skillInvocation = `$${options.autoSkill.trim()}`;
          const handle = await adapter.startRun({
            prompt: skillInvocation,
            ...baseRunContext
          });

          for await (const event of adapter.streamEvents(handle.runId)) {
            writeLine({ type: "adapter.event", event });
          }
        }

        const rl = createInterface({ input: process.stdin });
        for await (const line of rl) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === "/exit" || trimmed === "/quit") break;

          // Ignore prompt response lines (these are consumed by the Codex adapter stdin router).
          try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (isRecord(parsed) && parsed.type === "user_input.response") {
              continue;
            }
          } catch {
            // ignore
          }

          const handle = await adapter.startRun({
            prompt: trimmed,
            ...baseRunContext
          });

          for await (const event of adapter.streamEvents(handle.runId)) {
            writeLine({ type: "adapter.event", event });
          }
        }

        writeLine({ type: "codex.session.ended", at: new Date().toISOString() });
      } catch (error) {
        fail(error);
      }
    });

  return program;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function resolvePhaseGateScript(workspaceRoot: string, phase: string): Promise<string> {
  const phaseGatesPath = join(workspaceRoot, ".forge", "phase-gates.json");

  if (await exists(phaseGatesPath)) {
    const parsed = await readJsonFile<Record<string, unknown>>(phaseGatesPath);
    const phases =
      typeof parsed.phases === "object" && parsed.phases ? (parsed.phases as Record<string, unknown>) : parsed;
    const entry = phases[phase];
    if (typeof entry === "string" && entry.trim()) {
      return resolve(workspaceRoot, entry);
    }
  }

  // Fall back to installed guidance pack defaults (from .forge/guidance.json -> manifest.json).
  const guidancePath = join(workspaceRoot, ".forge", "guidance.json");
  const guidance = await readJsonFile<{ pack?: { path?: string } }>(guidancePath);
  const packRoot = guidance.pack?.path;
  if (!packRoot) {
    throw new Error(`Unable to resolve phase gate script for '${phase}': missing .forge/phase-gates.json and .forge/guidance.json`);
  }

  const manifest = await readJsonFile<{ default_phase_gate_bindings?: Record<string, string> }>(
    join(packRoot, "manifest.json")
  );
  const rel = manifest.default_phase_gate_bindings?.[phase];
  if (!rel) {
    throw new Error(`Unable to resolve phase gate script for '${phase}': no binding in pack manifest`);
  }
  return resolve(packRoot, rel);
}

export async function runCli(argv: string[]): Promise<void> {
  const cli = buildCli();
  await cli.parseAsync(argv);
}
