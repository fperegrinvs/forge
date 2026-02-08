import { resolve } from "node:path";

function parseArgs(argv) {
  const args = { plan: "", baseRef: undefined, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--plan") {
      args.plan = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (a === "--base-ref") {
      args.baseRef = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (a === "--json") {
      args.json = true;
      continue;
    }
  }
  return args;
}

async function main() {
  const { plan, baseRef, json } = parseArgs(process.argv.slice(2));
  if (!plan) {
    process.stderr.write("usage: node scripts/workflow-check.mjs --plan <path> [--base-ref <ref>] [--json]\n");
    process.exitCode = 2;
    return;
  }

  // `bun run workflow:check` runs after `tsc -b` in verify; import from dist for speed/portability.
  const mod = await import("../packages/control-plane/dist/workflow-check.js");
  const { runWorkflowCheck, formatWorkflowCheckSummary } = mod;

  const result = await runWorkflowCheck(process.cwd(), resolve(plan), baseRef);

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatWorkflowCheckSummary(result)}\n`);
  }

  if (!result.valid) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 3;
});

