import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exists } from "@forge/shared-utils";
import { initProject, scaffoldModule } from "./template.js";

describe("template package", () => {
  it("creates project skeleton", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-template-test-"));
    const project = await initProject("demo", dir);
    expect(await exists(join(project, "modules", "starter", "routes.ts"))).toBe(true);
  });

  it("creates canonical module structure", async () => {
    // Given an initialized project
    const dir = await mkdtemp(join(tmpdir(), "forge-module-test-"));
    const project = await initProject("demo", dir);

    // When a module is scaffolded with contract/property tests enabled
    await scaffoldModule("orders", project, { withContractTest: true, withPropertyTest: true });

    // Then the module structure and tests are created
    expect(await exists(join(project, "modules", "orders", "container.ts"))).toBe(true);
    expect(await exists(join(project, "contracts", "orders.contract.test.ts"))).toBe(true);
    expect(await exists(join(project, "tests", "orders.property.test.ts"))).toBe(true);
  });

  it("skips optional test files when disabled", async () => {
    // Given an initialized project
    const dir = await mkdtemp(join(tmpdir(), "forge-module-test-"));
    const project = await initProject("demo", dir);

    // When a module is scaffolded with optional tests disabled
    await scaffoldModule("payments", project, { withContractTest: false, withPropertyTest: false });

    // Then module files exist but optional tests do not
    expect(await exists(join(project, "modules", "payments", "container.ts"))).toBe(true);
    expect(await exists(join(project, "contracts", "payments.contract.test.ts"))).toBe(false);
    expect(await exists(join(project, "tests", "payments.property.test.ts"))).toBe(false);
  });
});
