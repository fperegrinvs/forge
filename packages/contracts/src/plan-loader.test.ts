import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlan } from "./plan-loader.js";

describe("loadPlan", () => {
  it("loads a plan JSON file from disk", async () => {
    // Given a plan file on disk
    const dir = await mkdtemp(join(tmpdir(), "forge-plan-loader-"));
    await mkdir(join(dir, "plans"), { recursive: true });
    const path = join(dir, "plans", "plan.json");
    const plan = {
      metadata: {
        project: "forge",
        created: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        spec_version: "v2",
        approved: true
      },
      context: {
        goals: ["goal"],
        constraints: ["constraint"],
        tech_decisions: {},
        architecture: "modulith"
      },
      tasks: []
    };
    await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    // When loadPlan is called
    const loaded = await loadPlan(path);

    // Then it returns the parsed object
    expect(loaded.metadata.project).toBe("forge");
    expect(loaded.metadata.spec_version).toBe("v2");
  });
});

