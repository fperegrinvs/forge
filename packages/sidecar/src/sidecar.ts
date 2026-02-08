import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { ForgeControlPlane, ForgeWorkflowRunner } from "@forge/control-plane";
import { CodexAppServerAdapter } from "@forge/adapter-codex";
import { ClaudePtyAdapter } from "@forge/adapter-claude";
import {
  CURRENT_PLAN_SPEC_VERSION,
  migratePlanToCurrentSpec,
} from "@forge/contracts";
import {
  getBundledGuidanceRoot,
  installGuidance,
  installGuidanceFromPackRoot,
  registerCodexSkills,
  summarizeGuidanceDiff
} from "@forge/guidance-pack";
import { initProject } from "@forge/templates";
import { exists, readJsonFile, runCommand } from "@forge/shared-utils";
import type { AdapterEvent, AgentAdapter } from "@forge/shared-utils";
import type { AdapterFactory, AdapterType, WorkflowAutoResult } from "@forge/control-plane";
import type { SidecarCommand } from "./index.js";

type ValidationIssue = { path: string; message: string; code: string };
type ValidationResult = { valid: boolean; issues: ValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type PlanMigrationResult = {
  migrated: boolean;
  wrote: boolean;
  filePath: string;
  fromSpecVersion?: string;
  toSpecVersion: string;
};

type ProjectGuidanceSource = {
  installedAt: string;
  pack: { name: string; version: string; path: string };
  forceReplace: boolean;
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

async function planValidate(planPath: string): Promise<ValidationResult> {
  const fullPath = resolve(process.cwd(), planPath);
  if (!(await exists(fullPath))) {
    return {
      valid: false,
      issues: [
        {
          path: planPath,
          message: `Plan file not found: ${fullPath}`,
          code: "plan_file_missing"
        }
      ]
    };
  }

  const controlPlane = new ForgeControlPlane(process.cwd());
  const result = await controlPlane.planValidate(fullPath);
  const issues = (() => {
    if (!isRecord(result)) return [];
    const raw = result.issues;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item): ValidationIssue | undefined => {
        if (!isRecord(item)) return undefined;
        const path = typeof item.path === "string" ? item.path : undefined;
        const message = typeof item.message === "string" ? item.message : undefined;
        // Widen from potential string-literal unions to plain string for the sidecar surface.
        const code: string | undefined = typeof item.code === "string" ? item.code : undefined;
        if (!path || !message || !code) return undefined;
        return { path, message, code };
      })
      .filter((x): x is ValidationIssue => x !== undefined);
  })();
  return {
    valid: isRecord(result) && typeof result.valid === "boolean" ? result.valid : false,
    issues
  };
}

function getSpecVersion(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const metadata = value.metadata;
  if (!isRecord(metadata)) return undefined;
  const specVersion = metadata.spec_version;
  return typeof specVersion === "string" ? specVersion : undefined;
}

async function planMigrate(planPath: string, write: boolean): Promise<PlanMigrationResult> {
  const fullPath = resolve(process.cwd(), planPath);
  const value = await readJsonFile<unknown>(fullPath);
  const fromSpecVersion = getSpecVersion(value);
  const toSpecVersion = CURRENT_PLAN_SPEC_VERSION;

  if (fromSpecVersion === toSpecVersion) {
    return {
      migrated: false,
      wrote: false,
      filePath: fullPath,
      fromSpecVersion,
      toSpecVersion
    };
  }

  const migrated = migratePlanToCurrentSpec(value as Parameters<typeof migratePlanToCurrentSpec>[0]);
  if (write) {
    await writeFile(fullPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  }

  return {
    migrated: true,
    wrote: write,
    filePath: fullPath,
    ...(fromSpecVersion ? { fromSpecVersion } : {}),
    toSpecVersion
  };
}

function buildAdapterFactory(): AdapterFactory {
  return (type: AdapterType): AgentAdapter => {
    if (type === "codex") {
      return new CodexAppServerAdapter();
    }
    return new ClaudePtyAdapter();
  };
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
    throw new Error(
      `Unable to resolve phase gate script for '${phase}': missing .forge/phase-gates.json and .forge/guidance.json`
    );
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

async function runWorkflowAutoStream(planPath: string, adapter: AdapterType, push: boolean): Promise<WorkflowAutoResult> {
  const workspaceRoot = process.cwd();
  const planFullPath = resolve(workspaceRoot, planPath);

  const writeLine = (value: unknown) => {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  };

  writeLine({
    type: "workflow.auto.started",
    plan: planFullPath,
    adapter,
    at: new Date().toISOString()
  });

  if (adapter === "codex") {
    try {
      const skillsDir = join(workspaceRoot, "skills");
      const preflight = await registerCodexSkills(skillsDir, workspaceRoot);
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

  const onAdapterEvent = (event: AdapterEvent) => {
    writeLine({ type: "adapter.event", event });
  };

  const runner = new ForgeWorkflowRunner(workspaceRoot, buildAdapterFactory(), {
    onAdapterEvent,
    gateRunner: async (phase: string, cwd: string) => {
      // Phase gates are simple scripts; run via bash so executable bits are not required.
      const scriptPath = await resolvePhaseGateScript(workspaceRoot, phase);
      const result = await runCommand("bash", [scriptPath], cwd);
      return {
        ok: result.exitCode === 0,
        name: phase,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      };
    },
    git: {
      async currentBranch() {
        const res = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], workspaceRoot);
        return res.stdout.trim();
      },
      async commit(message: string) {
        await runCommand("git", ["add", "-A"], workspaceRoot);
        const res = await runCommand("git", ["commit", "-m", message], workspaceRoot);
        if (res.exitCode !== 0) {
          throw new Error(res.stderr || res.stdout || "git commit failed");
        }
      },
      async push(remote: string) {
        const branchRes = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], workspaceRoot);
        const branch = branchRes.stdout.trim();
        const res = await runCommand("git", ["push", "-u", remote, branch], workspaceRoot);
        if (res.exitCode !== 0) {
          throw new Error(res.stderr || res.stdout || "git push failed");
        }
      }
    }
  });

  const maxRetries = Number.parseInt(process.env.FORGE_MAX_RETRIES ?? "3", 10);
  const options = {
    maxRetries: Number.isFinite(maxRetries) && maxRetries > 0 ? maxRetries : 3,
    push
  };

  const maxSteps = 5000;
  for (let i = 0; i < maxSteps; i += 1) {
    const step = await runner.runAuto(planFullPath, adapter, options);
    if (step.state === "running") {
      writeLine({ type: "workflow.auto.step", taskId: step.taskId, phase: step.phase, at: new Date().toISOString() });
      continue;
    }

    writeLine({ type: `workflow.auto.${step.state}`, step, at: new Date().toISOString() });
    return step;
  }

  throw new Error("workflow auto aborted: exceeded max steps");
}

async function codexSessionStream(autoSkill?: string): Promise<void> {
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

  if (typeof autoSkill === "string" && autoSkill.trim()) {
    const skillInvocation = `$${autoSkill.trim()}`;
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
}

export async function runSidecarCommand(cmd: SidecarCommand): Promise<unknown> {
  switch (cmd.command) {
    case "plan.validate": {
      return await planValidate(cmd.params.planPath);
    }
    case "plan.migrate": {
      return await planMigrate(cmd.params.planPath, cmd.params.write);
    }
    case "project.init": {
      const createdPath = await initProject(cmd.params.projectName, process.cwd());
      const guidanceResult = cmd.params.skipGuidance ? undefined : await installGuidance(createdPath);
      if (guidanceResult) {
        const bundledRoot = getBundledGuidanceRoot();
        const manifest = await readPackManifest(bundledRoot);
        if (manifest) {
          await writeGuidanceSourceFile(createdPath, {
            installedAt: new Date().toISOString(),
            pack: { ...manifest, path: bundledRoot },
            forceReplace: false
          });
        }
      }

      return {
        success: true,
        project: cmd.params.projectName,
        path: createdPath,
        guidance: guidanceResult
          ? {
              installed: guidanceResult.installed.length,
              updated: guidanceResult.updated.length,
              skipped: guidanceResult.skipped.length,
              summary: summarizeGuidanceDiff(guidanceResult)
            }
          : "skipped"
      };
    }
    case "guidance.installFromPack": {
      const packRoot = resolve(process.cwd(), cmd.params.packPath);
      const result = await installGuidanceFromPackRoot(packRoot, process.cwd(), {
        forceReplace: cmd.params.forceReplace
      });

      const manifest = await readPackManifest(packRoot);
      if (manifest) {
        await writeGuidanceSourceFile(process.cwd(), {
          installedAt: new Date().toISOString(),
          pack: { ...manifest, path: packRoot },
          forceReplace: cmd.params.forceReplace
        });
      }

      return { success: true, source: packRoot, result };
    }
    case "workflow.auto.stream": {
      return await runWorkflowAutoStream(cmd.params.planPath, cmd.params.adapter, cmd.params.push);
    }
    case "codex.session.stream": {
      await codexSessionStream(cmd.params.autoSkill);
      return { success: true };
    }
    default: {
      const _exhaustive: never = cmd;
      return _exhaustive;
    }
  }
}

export function sidecarExitCode(command: SidecarCommand["command"], result: unknown): number {
  if (command === "plan.validate") {
    if (isRecord(result) && typeof result.valid === "boolean") {
      return result.valid ? 0 : 2;
    }
    return 3;
  }

  return 0;
}

export function isStreamCommand(command: SidecarCommand["command"]): boolean {
  return command === "workflow.auto.stream" || command === "codex.session.stream";
}

export function parseSidecarCommand(value: unknown): SidecarCommand {
  if (!isRecord(value)) {
    throw new Error("sidecar command must be a JSON object");
  }
  const command = value.command;
  const params = value.params;
  if (typeof command !== "string") {
    throw new Error("sidecar command.command must be a string");
  }

  // Lightweight validation; rely on TypeScript types + downstream checks for details.
  return { command, params } as SidecarCommand;
}
