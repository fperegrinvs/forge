import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmod } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ScriptCheckRunner, loadTaskTypeRegistry } from "./check-runner.js";

describe("ScriptCheckRunner", () => {
  it("returns pass for successful script", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-checks-"));
    await mkdir(join(root, "implementation"), { recursive: true });
    const script = join(root, "implementation", "gate-green.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho ok\n", "utf8");
    await chmod(script, 0o755);

    const registry = await loadTaskTypeRegistry(root);
    const runner = new ScriptCheckRunner(registry);
    const result = await runner.runChecks("implementation", "task-1", root);
    expect(result[0]?.status).toBe("pass");
  });

  it("returns infra_error for missing bindings", async () => {
    const runner = new ScriptCheckRunner(new Map());
    const result = await runner.runChecks("unknown", "task-1", process.cwd());
    expect(result[0]?.status).toBe("infra_error");
  });

  it("returns fail when script exits non-zero", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-checks-fail-"));
    await mkdir(join(root, "implementation"), { recursive: true });
    const script = join(root, "implementation", "gate-green.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho bad\nexit 1\n", "utf8");
    await chmod(script, 0o755);

    const registry = await loadTaskTypeRegistry(root);
    const runner = new ScriptCheckRunner(registry);
    const result = await runner.runChecks("implementation", "task-1", root);
    expect(result[0]?.status).toBe("fail");
  });

  it("returns flaky when output marks flaky", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-checks-flaky-"));
    await mkdir(join(root, "implementation"), { recursive: true });
    const script = join(root, "implementation", "gate-green.sh");
    await writeFile(script, "#!/usr/bin/env bash\necho flaky: retry\nexit 0\n", "utf8");
    await chmod(script, 0o755);

    const registry = await loadTaskTypeRegistry(root);
    const runner = new ScriptCheckRunner(registry);
    const result = await runner.runChecks("implementation", "task-1", root);
    expect(result[0]?.status).toBe("flaky");
  });

  it("returns infra_error when binding points to missing script", async () => {
    const runner = new ScriptCheckRunner(
      new Map([
        [
          "implementation",
          {
            taskType: "implementation",
            scripts: [join(process.cwd(), "missing-script.sh")]
          }
        ]
      ])
    );
    const result = await runner.runChecks("implementation", "task-1", process.cwd());
    expect(result[0]?.status).toBe("infra_error");
  });
});
