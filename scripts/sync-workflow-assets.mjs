import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const policyPath = join(repoRoot, "packages", "guidance-pack", "src", "policy", "workflow-policy.v1.json");
const guidanceRoot = join(repoRoot, "packages", "guidance-pack", "src", "assets", "pack");
const checksRoot = join(repoRoot, "checks", "task-types");

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    const objectValue = value;
    const next = {};
    for (const key of Object.keys(objectValue).sort()) {
      next[key] = canonicalize(objectValue[key]);
    }
    return next;
  }

  return value;
}

function toPrettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createPolicyHash(policy) {
  const canonicalPolicy = canonicalize(policy);
  const payload = JSON.stringify(canonicalPolicy);
  return createHash("sha256").update(payload).digest("hex");
}

function renderAgents(policy) {
  const phases = policy.workflow.phases.join(" -> ");
  const gateCommands = policy.commands.gates;
  const mockTag = policy.quality.mock_annotation_tag;
  const gateLines = [
    `- gate:spec -> ${gateCommands.spec}`,
    `- gate:green -> ${gateCommands.green}`,
    `- gate:refactor -> ${gateCommands.refactor}`
  ];

  if (gateCommands.architecture) {
    gateLines.push(`- gate:architecture -> ${gateCommands.architecture}`);
  }

  gateLines.push(
    `- gate:docs -> ${gateCommands.docs}`,
    `- gate:commit -> ${gateCommands.commit}`,
    `- gate:verify -> ${gateCommands.verify}`
  );

  return [
    "# Forge AGENTS",
    "",
    `Workflow policy version: ${policy.version}`,
    "",
    "## Required Workflow",
    `- Follow phases in order: ${phases}.`,
    "- Use code-first BDD with Given/When/Then comments in tests.",
    `- Prefer fakes over mocks. Mocks require annotation (${mockTag}) and are only for adapter_boundary or failure_simulation.`,
    "- Keep modulith boundaries and import restrictions intact.",
    "- Update documentation and decisions together with code changes.",
    "",
    "## Canonical Gates",
    ...gateLines,
    ""
  ].join("\n");
}

function renderAgentsOverride(policy) {
  return [
    "# Forge AGENTS Override",
    "",
    `Policy version: ${policy.version}`,
    "",
    "Use this file only for nearest-directory overrides that tighten constraints.",
    "Do not weaken required workflow gates from the root AGENTS.md.",
    ""
  ].join("\n");
}

function renderTestingRule(policy) {
  const mockTag = policy.quality.mock_annotation_tag;
  const mockReasons = policy.quality.allow_mocks_only_for.map((reason) => `- ${reason}`).join("\n");
  const boundaryGlobs = policy.quality.mock_boundary_test_globs.map((glob) => `- ${glob}`).join("\n");
  const gateCommands = policy.commands.gates;
  const gateLines = [
    `Run gate:spec with: ${gateCommands.spec}`,
    `Run gate:green with: ${gateCommands.green}`
  ];

  if (gateCommands.architecture) {
    gateLines.push(`Run gate:architecture with: ${gateCommands.architecture}`);
  }

  gateLines.push(`Run gate:refactor with: ${gateCommands.refactor}`);

  return [
    "# Testing Rules",
    "",
    `- require_bdd: ${String(policy.quality.require_bdd)}`,
    `- require_property_tests: ${String(policy.quality.require_property_tests)}`,
    `- require_contract_tests: ${String(policy.quality.require_contract_tests)}`,
    `- mock_policy: ${String(policy.quality.mock_policy)}`,
    "",
    "Use code-first BDD in test files with Given/When/Then comments.",
    "Prefer fakes for test doubles.",
    "Only use mocks when allowed by policy and annotate each mock call site.",
    `Annotation format: // ${mockTag}: <reason>`,
    "Allowed reasons:",
    mockReasons,
    "Adapter-boundary reason is allowed only in:",
    boundaryGlobs,
    ...gateLines,
    ""
  ].join("\n");
}

function renderArchitectureRule() {
  return [
    "# Architecture Rules",
    "",
    "- Follow modulith module boundaries and import restrictions.",
    "- Keep dependencies pointing inward: domain does not import infrastructure.",
    "- Keep public module API in index.ts and route registration in routes.ts.",
    ""
  ].join("\n");
}

function renderDocumentationRule(policy) {
  const allowed = policy.docs.allowed_update_globs.map((glob) => `- ${glob}`).join("\n");
  return [
    "# Documentation Rules",
    "",
    `- require_docs_updates: ${String(policy.quality.require_docs_updates)}`,
    "- Update docs whenever implementation changes behavior or interfaces.",
    "- Record rationale in decision notes and decisions.md.",
    `Run gate:docs with: ${policy.commands.gates.docs}`,
    "",
    "Allowed documentation update globs:",
    allowed,
    ""
  ].join("\n");
}

function renderSkill(skill, policy) {
  const instructionLines = skill.instructions.map((line) => `- ${line}`);

  return [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    "---",
    "",
    `# ${skill.name}`,
    "",
    `Default prompt: ${skill.default_prompt}`,
    "",
    "## Workflow",
    `- Follow phases: ${policy.workflow.phases.join(" -> ")}.`,
    "- Keep changes deterministic and aligned with policy gates.",
    "",
    "## Instructions",
    ...instructionLines,
    ""
  ].join("\n");
}

function renderGateScript(command) {
  return ["#!/usr/bin/env bash", "set -euo pipefail", command, ""].join("\n");
}

async function listDirectories(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function listFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

function buildExpectedAssets(policy) {
  const policyHash = createPolicyHash(policy);

  const manifest = {
    name: "forge-guidance-pack",
    version: "1.0.0",
    workflow_policy_version: policy.version,
    workflow_policy_hash: policyHash,
    context: {
      max_read_bytes: 262144
    },
    fallback_files: {
      plan: "PLAN.md",
      execution_log: "EXECUTION_LOG.md",
      decisions: "decisions.md"
    },
    agents_precedence: ["global", "repo_root", "nearest_directory_override"]
  };

  const codexConfig = {
    approval_mode: "suggest",
    workflow_policy_version: policy.version,
    workflow_policy_hash: policyHash
  };

  const expectedFiles = new Map();

  expectedFiles.set(join(guidanceRoot, "AGENTS.md"), renderAgents(policy));
  expectedFiles.set(join(guidanceRoot, "AGENTS.override.md"), renderAgentsOverride(policy));
  expectedFiles.set(join(guidanceRoot, "rules", "testing.md"), renderTestingRule(policy));
  expectedFiles.set(join(guidanceRoot, "rules", "architecture.md"), renderArchitectureRule());
  expectedFiles.set(join(guidanceRoot, "rules", "documentation.md"), renderDocumentationRule(policy));
  expectedFiles.set(join(guidanceRoot, "manifest.json"), toPrettyJson(manifest));
  expectedFiles.set(join(guidanceRoot, "codex", "config.json"), toPrettyJson(codexConfig));

  for (const skill of policy.skills) {
    expectedFiles.set(join(guidanceRoot, "skills", skill.name, "SKILL.md"), renderSkill(skill, policy));
  }

  const expectedScripts = new Map();
  const taskTypeGates = policy.check_runner.task_type_gates;

  for (const [taskType, gates] of Object.entries(taskTypeGates)) {
    for (const gate of gates) {
      const command = policy.commands.gates[gate];
      if (!command) {
        throw new Error(`Unknown gate '${gate}' for task type '${taskType}'`);
      }

      const scriptPath = join(checksRoot, taskType, `gate-${gate}.sh`);
      expectedScripts.set(scriptPath, renderGateScript(command));
    }
  }

  const expectedSymlinks = new Map();

  const rootGuidanceLinks = {
    "AGENTS.md": join(guidanceRoot, "AGENTS.md"),
    "AGENTS.override.md": join(guidanceRoot, "AGENTS.override.md"),
    rules: join(guidanceRoot, "rules"),
    skills: join(guidanceRoot, "skills"),
    codex: join(guidanceRoot, "codex")
  };

  for (const [name, targetAbs] of Object.entries(rootGuidanceLinks)) {
    expectedSymlinks.set(join(repoRoot, name), targetAbs);
  }

  expectedSymlinks.set(join(repoRoot, "CLAUDE.md"), join(repoRoot, "AGENTS.md"));
  expectedSymlinks.set(join(repoRoot, ".claude", "CLAUDE.md"), join(repoRoot, "CLAUDE.md"));
  expectedSymlinks.set(join(repoRoot, ".claude", "skills"), join(repoRoot, "skills"));
  expectedSymlinks.set(join(repoRoot, ".claude", "rules"), join(repoRoot, "rules"));

  return { expectedFiles, expectedScripts, expectedSymlinks };
}

async function writeExpected(expectedFiles, expectedScripts) {
  for (const [path, content] of expectedFiles) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  for (const [path, content] of expectedScripts) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    await chmod(path, 0o755);
  }
}

async function ensureSymlinks(expectedSymlinks) {
  for (const [linkPath, targetAbs] of expectedSymlinks) {
    await mkdir(dirname(linkPath), { recursive: true });
    const expectedTarget = relative(dirname(linkPath), targetAbs);
    const stat = await lstat(linkPath).catch(() => null);

    if (stat && !stat.isSymbolicLink()) {
      await rm(linkPath, { recursive: true, force: true });
    }

    if (stat?.isSymbolicLink()) {
      const currentTarget = await readlink(linkPath);
      if (currentTarget === expectedTarget) {
        continue;
      }
      await rm(linkPath, { recursive: true, force: true });
    }

    await symlink(expectedTarget, linkPath);
  }
}

async function removeStale(policy, expectedScripts) {
  const skillsDir = join(guidanceRoot, "skills");
  const expectedSkillNames = new Set(policy.skills.map((skill) => skill.name));

  for (const dirName of await listDirectories(skillsDir)) {
    if (!expectedSkillNames.has(dirName)) {
      await rm(join(skillsDir, dirName), { recursive: true, force: true });
    }
  }

  const expectedScriptsByDir = new Map();
  for (const scriptPath of expectedScripts.keys()) {
    const dir = dirname(scriptPath);
    const set = expectedScriptsByDir.get(dir) ?? new Set();
    set.add(scriptPath);
    expectedScriptsByDir.set(dir, set);
  }

  for (const [taskType] of Object.entries(policy.check_runner.task_type_gates)) {
    const dir = join(checksRoot, taskType);
    const expectedInDir = expectedScriptsByDir.get(dir) ?? new Set();
    for (const fileName of await listFiles(dir)) {
      if (!fileName.startsWith("gate-") || !fileName.endsWith(".sh")) {
        continue;
      }
      const fullPath = join(dir, fileName);
      if (!expectedInDir.has(fullPath)) {
        await rm(fullPath, { force: true });
      }
    }
  }
}

async function collectMismatches(policy, expectedFiles, expectedScripts, expectedSymlinks) {
  const mismatches = [];

  for (const [path, expectedContent] of [...expectedFiles, ...expectedScripts]) {
    const actualContent = await readFile(path, "utf8").catch(() => null);
    if (actualContent === null) {
      mismatches.push(`missing: ${path}`);
      continue;
    }

    if (actualContent !== expectedContent) {
      mismatches.push(`outdated: ${path}`);
    }
  }

  for (const [linkPath, targetAbs] of expectedSymlinks) {
    const stat = await lstat(linkPath).catch(() => null);
    if (!stat) {
      mismatches.push(`missing symlink: ${linkPath}`);
      continue;
    }

    if (!stat.isSymbolicLink()) {
      mismatches.push(`not a symlink: ${linkPath}`);
      continue;
    }

    const actualTarget = await readlink(linkPath);
    const expectedTarget = relative(dirname(linkPath), targetAbs);
    if (actualTarget !== expectedTarget) {
      mismatches.push(`symlink target mismatch: ${linkPath} -> ${actualTarget} (expected ${expectedTarget})`);
    }
  }

  const skillsDir = join(guidanceRoot, "skills");
  const expectedSkillNames = new Set(policy.skills.map((skill) => skill.name));

  for (const dirName of await listDirectories(skillsDir)) {
    if (!expectedSkillNames.has(dirName)) {
      mismatches.push(`unexpected skill directory: ${join(skillsDir, dirName)}`);
    }
  }

  for (const [taskType] of await readdir(checksRoot, { withFileTypes: true }).then((entries) =>
    entries.filter((entry) => entry.isDirectory()).map((entry) => [entry.name])
  )) {
    const dir = join(checksRoot, taskType);
    const expectedInDir = new Set(
      [...expectedScripts.keys()].filter((path) => dirname(path) === dir).map((path) => path)
    );

    for (const fileName of await listFiles(dir)) {
      if (!fileName.startsWith("gate-") || !fileName.endsWith(".sh")) {
        continue;
      }
      const fullPath = join(dir, fileName);
      if (!expectedInDir.has(fullPath)) {
        mismatches.push(`unexpected gate script: ${fullPath}`);
      }
    }
  }

  return mismatches;
}

export async function syncWorkflowAssets({ check = false } = {}) {
  const policyRaw = await readFile(policyPath, "utf8");
  const policy = JSON.parse(policyRaw);
  const { expectedFiles, expectedScripts, expectedSymlinks } = buildExpectedAssets(policy);

  if (check) {
    const mismatches = await collectMismatches(policy, expectedFiles, expectedScripts, expectedSymlinks);
    if (mismatches.length > 0) {
      throw new Error(`Workflow assets out of sync:\n${mismatches.join("\n")}`);
    }
    return;
  }

  await writeExpected(expectedFiles, expectedScripts);
  await removeStale(policy, expectedScripts);
  await ensureSymlinks(expectedSymlinks);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  syncWorkflowAssets({ check })
    .then(() => {
      process.stdout.write(check ? "Workflow assets are in sync\n" : "Workflow assets synchronized\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}
