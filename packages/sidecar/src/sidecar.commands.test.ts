import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSidecarCommandWithCwd, sidecarExitCode } from "./sidecar.js";

function v1Plan(): any {
  return {
    metadata: {
      project: "forge",
      created: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      spec_version: "v1",
      approved: true
    },
    context: {
      goals: ["goal"],
      constraints: ["constraint"],
      tech_decisions: {},
      architecture: "modulith"
    },
    tasks: [
      {
        id: "task-1",
        task_type: "implementation",
        name: "Task",
        description: "desc",
        files: ["src/a.ts"],
        dependencies: [],
        acceptance_criteria: ["done"],
        verification_command: "echo ok"
      }
    ]
  };
}

function v2Plan(): any {
  return {
    ...v1Plan(),
    metadata: {
      ...v1Plan().metadata,
      spec_version: "v2"
    },
    tasks: [
      {
        ...v1Plan().tasks[0],
        tests: { bdd_scenarios: ["Given X When Y Then Z"], property_invariants: [], contract_tests: [] },
        documentation: { updates: ["docs/architecture.md"], decision_notes: "note" }
      }
    ]
  };
}

describe("sidecar commands", () => {
  it("plan.validate returns structured issues for missing plans (exit code 2)", async () => {
    // Given a workspace with no plan file
    const workspace = await mkdtemp(join(tmpdir(), "forge-sidecar-"));

    // When plan validation is requested
    const result = await runSidecarCommandWithCwd(workspace, {
      command: "plan.validate",
      params: { planPath: "plans/missing.plan.json" }
    });

    // Then it returns a structured invalid result (not a thrown error)
    expect((result as any).valid).toBe(false);
    expect(Array.isArray((result as any).issues)).toBe(true);
    expect(sidecarExitCode("plan.validate", result)).toBe(2);
  });

  it("plan.validate returns valid=true for a well-formed v2 plan", async () => {
    // Given a valid plan file
    const workspace = await mkdtemp(join(tmpdir(), "forge-sidecar-"));
    await mkdir(join(workspace, "plans"), { recursive: true });
    const planPath = join(workspace, "plans", "plan.json");
    await writeFile(planPath, `${JSON.stringify(v2Plan(), null, 2)}\n`, "utf8");

    // When validation is requested
    const result = await runSidecarCommandWithCwd(workspace, {
      command: "plan.validate",
      params: { planPath: "plans/plan.json" }
    });

    // Then it is valid
    expect((result as any).valid).toBe(true);
    expect((result as any).issues).toEqual([]);
    expect(sidecarExitCode("plan.validate", result)).toBe(0);
  });

  it("plan.migrate upgrades v1 plans to v2 and writes when requested", async () => {
    // Given a v1 plan file
    const workspace = await mkdtemp(join(tmpdir(), "forge-sidecar-"));
    await mkdir(join(workspace, "plans"), { recursive: true });
    const planPath = join(workspace, "plans", "plan.json");
    await writeFile(planPath, `${JSON.stringify(v1Plan(), null, 2)}\n`, "utf8");

    // When migration is requested with write=true
    const result = await runSidecarCommandWithCwd(workspace, {
      command: "plan.migrate",
      params: { planPath: "plans/plan.json", write: true }
    });

    // Then it reports migrated and the file is updated on disk
    expect((result as any).migrated).toBe(true);
    const migrated = JSON.parse(await readFile(planPath, "utf8"));
    expect(migrated.metadata.spec_version).toBe("v2");
  });

  it("guidance.installFromPack installs pack contents into the workspace and records guidance source", async () => {
    // Given a minimal pack root
    const workspace = await mkdtemp(join(tmpdir(), "forge-sidecar-"));
    const packRoot = await mkdtemp(join(tmpdir(), "forge-pack-"));
    await mkdir(join(packRoot, "rules"), { recursive: true });
    await writeFile(
      join(packRoot, "manifest.json"),
      `${JSON.stringify({ name: "forge-guidance-pack", version: "1.2.3" }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(join(packRoot, "rules", "project.md"), "hello\n", "utf8");

    // When guidance is installed from the pack
    const result = await runSidecarCommandWithCwd(workspace, {
      command: "guidance.installFromPack",
      params: { packPath: packRoot, forceReplace: true }
    });

    // Then the install succeeds and guidance source metadata is written
    expect((result as any).success).toBe(true);
    const source = JSON.parse(await readFile(join(workspace, ".forge", "guidance.json"), "utf8"));
    expect(source.pack.name).toBe("forge-guidance-pack");
    expect(source.pack.version).toBe("1.2.3");
  });
});

