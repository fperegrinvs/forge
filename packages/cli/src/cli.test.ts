import { describe, expect, it } from "vitest";
import { buildCli } from "./cli.js";

describe("cli", () => {
  it("builds command tree", () => {
    const cli = buildCli();
    const names = cli.commands.map((command) => command.name());
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
});
