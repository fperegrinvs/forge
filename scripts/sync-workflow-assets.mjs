import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const policyPath = join(repoRoot, "packages", "guidance-pack", "src", "policy", "workflow-policy.v1.json");
const guidanceRoot = join(repoRoot, "packages", "guidance-pack", "src", "assets", "pack");
const checksRoot = join(repoRoot, "checks", "task-types");
const referencesRoot = join(repoRoot, "packages", "guidance-pack", "src", "references");

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

  if (gateCommands.coverage) {
    gateLines.push(`- gate:coverage -> ${gateCommands.coverage}`);
  }

  gateLines.push(
    `- gate:docs -> ${gateCommands.docs}`,
    `- gate:commit -> ${gateCommands.commit}`,
    `- gate:verify -> ${gateCommands.verify}`
  );

  const sections = [
    "# Forge AGENTS",
    "",
    `Workflow policy version: ${policy.version}`,
    "",
    "## Required Workflow",
    `- Follow phases in order: ${phases}.`,
    "- Each phase ends with its gate passing AND a commit. No silent phase transitions.",
    "- Do not advance to the next phase until the gate passes (except diagnostic gates).",
    "- Before starting work: fetch latest (`git fetch origin`) and rebase onto `origin/main`.",
    "- Use code-first BDD with Given/When/Then comments in tests.",
    `- Prefer fakes over mocks. Mocks require annotation (${mockTag}) and are only for adapter_boundary or failure_simulation.`,
    "- Keep modulith boundaries and import restrictions intact.",
    "- Update documentation and decisions together with code changes.",
    "- Never commit or push directly to `main`. Work on a `codex/*` branch and open a PR.",
    "",
    "## Canonical Gates",
    ...gateLines
  ];

  const discipline = policy.workflow.discipline;
  if (discipline) {
    sections.push(
      "",
      `## ${discipline.method}`,
      "",
      ...discipline.rules.map((rule) => `- ${rule}`)
    );
  }

  const phaseGates = policy.workflow.phase_gates;
  if (phaseGates) {
    sections.push(
      "",
      "## Phase → Gate → Commit",
      "",
      "| Phase | Gate | Commit | Diagnostic |",
      "|-------|------|--------|------------|",
      ...Object.entries(phaseGates).map(([phase, cfg]) =>
        `| ${phase} | ${cfg.gate} | ${cfg.commit ? "yes" : "no"} | ${cfg.diagnostic ? "yes" : "no"} |`
      )
    );
  }

  sections.push("");

  return sections.join("\n");
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
  const thresholds = policy.quality.coverage_thresholds;
  const coverageSection = thresholds
    ? [
        "",
        "## Coverage",
        "",
        "Coverage is required and enforced in CI.",
        "",
        "Minimum thresholds:",
        `- lines: ${String(thresholds.lines)}%`,
        `- statements: ${String(thresholds.statements)}%`,
        `- functions: ${String(thresholds.functions)}%`,
        `- branches: ${String(thresholds.branches)}%`,
        ""
      ]
    : [];

  const taxonomy = policy.quality.property_test_taxonomy;
  const taxonomySection = taxonomy
    ? [
        "",
        "## Property-Based Test Taxonomy",
        "",
        ...taxonomy.map((entry) => `- ${entry}`),
        ""
      ]
    : [];

  const patterns = policy.quality.testing_patterns;
  const patternsSection = patterns
    ? [
        "",
        "## Testing Patterns",
        "",
        `- ${patterns.black_box}`,
        `- ${patterns.build_test_app}`,
        ""
      ]
    : [];

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
    ...coverageSection,
    ...taxonomySection,
    ...patternsSection,
    ""
  ].join("\n");
}

function renderArchitectureRule(policy) {
  const arch = policy.architecture;

  if (!arch) {
    return [
      "# Architecture Rules",
      "",
      "- Follow modulith module boundaries and import restrictions.",
      "- Keep dependencies pointing inward: domain does not import infrastructure.",
      "- Keep public module API in index.ts and route registration in routes.ts.",
      ""
    ].join("\n");
  }

  const layoutLines = arch.module_layout.map((entry) => `- ${entry}`);

  return [
    "# Architecture Rules",
    "",
    "## Module Layout",
    "",
    "Every module directory contains:",
    "",
    ...layoutLines,
    "",
    "## Dependency Direction",
    "",
    `\`${arch.dependency_direction}\``,
    "",
    `${arch.barrel_export_rule}.`,
    "",
    "## DI Pattern",
    "",
    `${arch.di_pattern}.`,
    "",
    "## Route Pattern",
    "",
    `${arch.route_pattern}.`,
    "",
    "## Shared Types",
    "",
    `${arch.shared_types}.`,
    ""
  ].join("\n");
}

function renderStackRule(policy) {
  const stack = policy.stack;

  if (!stack) {
    return null;
  }

  const techEntries = [
    ["Runtime", stack.runtime],
    ["Language", stack.language],
    ["Backend", stack.backend],
    ["DI", stack.di],
    ["Validation", stack.validation],
    ["Frontend", stack.frontend],
    ["Bundler", stack.bundler],
    ["Testing", stack.testing]
  ];

  const techLines = techEntries.map(([key, value]) => `| ${key} | ${value} |`);
  const antiPatternLines = stack.anti_patterns.map((entry) => `- ${entry}`);

  return [
    "# Stack",
    "",
    "| Layer | Technology |",
    "|-------|-----------|",
    ...techLines,
    "",
    `**Serving model**: ${stack.serving_model}`,
    "",
    "## Do Not Use",
    "",
    ...antiPatternLines,
    ""
  ].join("\n");
}

function renderProjectRule(policy) {
  const project = policy.project;
  const packageLines = project.key_packages.map((pkg) => `- ${pkg}`).join("\n");
  return [
    "# Project Context",
    "",
    `**${project.name}**: ${project.description}`,
    "",
    `**Architecture**: ${project.architecture}`,
    "",
    "## Key Packages",
    packageLines,
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
    "",
    "Allowed documentation update globs:",
    allowed,
    ""
  ].join("\n");
}

function renderWorkflowRule(policy) {
  const phases = policy.workflow.phases.join(" -> ");
  const discipline = policy.workflow.discipline;
  const phaseGates = policy.workflow.phase_gates;

  const sections = [
    "# Workflow Discipline",
    "",
    `Phases: ${phases}`,
    ""
  ];

  if (discipline) {
    sections.push(
      `## ${discipline.method}`,
      "",
      ...discipline.rules.map((rule) => `- ${rule}`),
      ""
    );
  }

  if (phaseGates) {
    sections.push(
      "## Phase → Gate → Commit",
      "",
      "| Phase | Gate | Commit | Prefix | Diagnostic |",
      "|-------|------|--------|--------|------------|",
      ...Object.entries(phaseGates).map(([phase, cfg]) =>
        `| ${phase} | ${cfg.gate} | ${cfg.commit ? "yes" : "no"} | ${cfg.prefix ?? "—"} | ${cfg.diagnostic ? "yes" : "no"} |`
      ),
      "",
      "- **Diagnostic gate**: run for observation (confirm red), not as a pass/fail blocker.",
      "- **Non-diagnostic gate**: MUST pass before committing and advancing.",
      "- **Commit**: create a commit with the phase prefix after the gate passes.",
      ""
    );
  }

  return sections.join("\n");
}

function renderSkill(skill, policy) {
  const instructionLines = skill.instructions.map((line) => `- ${line}`);
  const phaseGates = policy.workflow.phase_gates;

  const workflowLines = [
    `- Follow phases: ${policy.workflow.phases.join(" -> ")}.`,
    "- Keep changes deterministic and aligned with policy gates."
  ];

  if (phaseGates) {
    workflowLines.push(
      "- Each phase ends with its gate passing AND a commit.",
      "- Do not advance to the next phase until the gate passes (except diagnostic gates)."
    );
  }

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
    ...workflowLines,
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

async function buildExpectedAssets(policy) {
  const policyHash = createPolicyHash(policy);

  const phaseGates = policy.workflow.phase_gates ?? {};
  const phaseGateScriptsDirRel = "scripts/phase-gates";
  const defaultPhaseGateBindings = {};
  for (const phase of policy.workflow.phases ?? []) {
    // Bind every known phase to a policy-generated gate wrapper script by default.
    defaultPhaseGateBindings[phase] = `${phaseGateScriptsDirRel}/${phase}.sh`;
  }

  const manifest = {
    name: "forge-guidance-pack",
    version: "1.0.0",
    workflow_policy_version: policy.version,
    workflow_policy_hash: policyHash,
    default_phase_gate_bindings: defaultPhaseGateBindings,
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
  expectedFiles.set(join(guidanceRoot, "rules", "architecture.md"), renderArchitectureRule(policy));
  expectedFiles.set(join(guidanceRoot, "rules", "project.md"), renderProjectRule(policy));

  const stackContent = renderStackRule(policy);
  if (stackContent) {
    expectedFiles.set(join(guidanceRoot, "rules", "stack.md"), stackContent);
  }
  expectedFiles.set(join(guidanceRoot, "rules", "documentation.md"), renderDocumentationRule(policy));
  expectedFiles.set(join(guidanceRoot, "rules", "workflow.md"), renderWorkflowRule(policy));
  expectedFiles.set(join(guidanceRoot, "manifest.json"), toPrettyJson(manifest));
  expectedFiles.set(join(guidanceRoot, "codex", "config.json"), toPrettyJson(codexConfig));

  for (const skill of policy.skills) {
    expectedFiles.set(join(guidanceRoot, "skills", skill.name, "SKILL.md"), renderSkill(skill, policy));
  }

  const referenceMap = policy.reference_map ?? {};
  for (const [skillName, refFiles] of Object.entries(referenceMap)) {
    for (const refFile of refFiles) {
      const sourcePath = join(referencesRoot, refFile);
      const content = await readFile(sourcePath, "utf8").catch(() => null);
      if (content !== null) {
        expectedFiles.set(join(guidanceRoot, "skills", skillName, "references", refFile), content);
      }
    }
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

  // Phase-level gate wrapper scripts live inside the pack itself so they can be
  // referenced via project-relative bindings seeded from the pack manifest.
  for (const phase of policy.workflow.phases ?? []) {
    const cfg = phaseGates[phase];
    const gate = cfg?.gate;
    const command = gate ? policy.commands.gates[gate] : null;
    if (!command) {
      throw new Error(`Unknown or missing phase gate command for phase '${phase}' (gate='${String(gate)}')`);
    }
    const scriptPath = join(guidanceRoot, phaseGateScriptsDirRel, `${phase}.sh`);
    expectedScripts.set(scriptPath, renderGateScript(command));
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

async function removeStale(policy, expectedFiles, expectedScripts) {
  const skillsDir = join(guidanceRoot, "skills");
  const expectedSkillNames = new Set(policy.skills.map((skill) => skill.name));

  for (const dirName of await listDirectories(skillsDir)) {
    if (!expectedSkillNames.has(dirName)) {
      await rm(join(skillsDir, dirName), { recursive: true, force: true });
      continue;
    }

    const refsDir = join(skillsDir, dirName, "references");
    for (const fileName of await listFiles(refsDir)) {
      const fullPath = join(refsDir, fileName);
      if (!expectedFiles.has(fullPath)) {
        await rm(fullPath, { force: true });
      }
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
      continue;
    }

    const refsDir = join(skillsDir, dirName, "references");
    for (const fileName of await listFiles(refsDir)) {
      const fullPath = join(refsDir, fileName);
      if (!expectedFiles.has(fullPath)) {
        mismatches.push(`unexpected reference file: ${fullPath}`);
      }
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
  const { expectedFiles, expectedScripts, expectedSymlinks } = await buildExpectedAssets(policy);

  if (check) {
    const mismatches = await collectMismatches(policy, expectedFiles, expectedScripts, expectedSymlinks);
    if (mismatches.length > 0) {
      throw new Error(`Workflow assets out of sync:\n${mismatches.join("\n")}`);
    }
    return;
  }

  await writeExpected(expectedFiles, expectedScripts);
  await removeStale(policy, expectedFiles, expectedScripts);
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
