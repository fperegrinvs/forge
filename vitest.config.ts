import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

type Alias = { find: string; replacement: string };

const repoRoot = dirname(fileURLToPath(import.meta.url));

function loadWorkspaceAliases(): Alias[] {
  // Vitest resolves workspace packages via package "exports" (usually `dist/`),
  // but tests should run on a clean checkout without requiring `tsc -b` first.
  // Alias each workspace package name to its `src/` entrypoint for tests.
  const aliases: Alias[] = [];

  const candidates = [
    { base: "packages", entryCandidates: ["src/index.ts", "src/index.tsx"] },
    { base: "apps", entryCandidates: ["src/index.ts", "src/index.tsx", "src/main.ts"] }
  ] as const;

  for (const { base, entryCandidates } of candidates) {
    const root = join(repoRoot, base);
    if (!existsSync(root)) {
      continue;
    }

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workspaceDir = join(root, entry.name);
      const pkgJsonPath = join(workspaceDir, "package.json");
      if (!existsSync(pkgJsonPath)) {
        continue;
      }

      let name: string | undefined;
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { name?: unknown };
        name = typeof pkg.name === "string" ? pkg.name : undefined;
      } catch {
        name = undefined;
      }
      if (!name) {
        continue;
      }

      for (const entryCandidate of entryCandidates) {
        const resolved = join(workspaceDir, entryCandidate);
        if (existsSync(resolved)) {
          aliases.push({ find: name, replacement: resolved });
          break;
        }
      }
    }
  }

  return aliases;
}

export default defineConfig({
  resolve: {
    alias: loadWorkspaceAliases()
  },
  test: {
    // Workspace projects (replaces deprecated vitest.workspace.ts).
    projects: ["packages/*", "apps/*"],

    // Coverage is enabled via `vitest run --coverage` (`bun run test:coverage`).
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "lcov", "html"],
      all: true,
      clean: true,

      // Measure shipped runtime TS, not embedded templates/assets or build outputs.
      include: ["packages/**/src/**/*.ts", "apps/**/src/**/*.ts", "apps/**/src/**/*.tsx"],
      exclude: [
        "**/*.d.ts",
        "**/*.test.*",
        "**/dist/**",
        "**/node_modules/**",
        "**/src/types.ts",
        "apps/**/src/main.ts",
        "packages/**/src/assets/**",
        "packages/cli/src/bin.ts",
        "packages/guidance-pack/src/assets/**",
        "packages/templates/src/assets/**"
      ],

      // Baseline thresholds (strict).
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70
      }
    }
  }
});
