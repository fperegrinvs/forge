import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
        "packages/**/src/assets/**",
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

