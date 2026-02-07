import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "apps/desktop/src-tauri/target/**",
      "scripts/**/*.mjs",
      "**/*.test.ts",
      "**/*.test.tsx",
      "apps/desktop/src/**/*.vue",
      "apps/desktop/src/main.ts",
      "apps/desktop/vite.config.ts",
      "packages/templates/src/assets/**",
      "eslint.config.ts",
      "vitest.workspace.ts"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "import/no-cycle": "error",
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            { "target": "./modules/*/domain/**", "from": "./modules/*/infrastructure/**" },
            { "target": "./modules/*/domain/**", "from": "./modules/*/routes.*" }
          ]
        }
      ]
    }
  }
);
