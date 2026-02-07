import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const requiredModuleFiles = ["index.ts", "routes.ts", "container.ts"];
const templateModuleRoot = resolve("packages/templates/src/assets/forge-template/modules");
const moduleTemplateRoot = resolve("packages/templates/src/assets/module");
const errors = [];

async function assertFilePattern(filePath, pattern, message) {
  const content = await readFile(filePath, "utf8").catch(() => "");
  if (!pattern.test(content)) {
    errors.push(message);
  }
}

async function validateModule(moduleDir, moduleName) {
  for (const fileName of requiredModuleFiles) {
    const fullPath = join(moduleDir, fileName);
    await readFile(fullPath, "utf8").catch(() => {
      errors.push(`module '${moduleName}' is missing ${fileName}`);
      return "";
    });
  }

  await assertFilePattern(
    join(moduleDir, "container.ts"),
    /export\s+function\s+register[A-Za-z0-9]+Module\s*\(/,
    `module '${moduleName}' container.ts must export register*Module(...)`
  );

  await assertFilePattern(
    join(moduleDir, "routes.ts"),
    /RouteRegistrar/,
    `module '${moduleName}' routes.ts must reference RouteRegistrar`
  );

  await assertFilePattern(
    join(moduleDir, "routes.ts"),
    /export\s+default\s+/,
    `module '${moduleName}' routes.ts must default-export registrar`
  );
}

async function validateTemplateFiles() {
  const requiredTemplates = [
    "container.ts.tpl",
    "index.ts.tpl",
    "routes.ts.tpl"
  ];

  for (const template of requiredTemplates) {
    const path = join(moduleTemplateRoot, template);
    await readFile(path, "utf8").catch(() => {
      errors.push(`missing module template: ${path}`);
      return "";
    });
  }

  await assertFilePattern(
    join(moduleTemplateRoot, "container.ts.tpl"),
    /export\s+function\s+register\{\{pascalName\}\}Module\s*\(/,
    "container.ts.tpl must export register{{pascalName}}Module(...)"
  );

  await assertFilePattern(
    join(moduleTemplateRoot, "routes.ts.tpl"),
    /RouteRegistrar/,
    "routes.ts.tpl must reference RouteRegistrar"
  );

  await assertFilePattern(
    join(moduleTemplateRoot, "routes.ts.tpl"),
    /export\s+default\s+/,
    "routes.ts.tpl must default-export registrar"
  );

  await assertFilePattern(
    join(moduleTemplateRoot, "index.ts.tpl"),
    /services\/\{\{name\}\}\.service\.js/,
    "index.ts.tpl must export services/{{name}}.service.js"
  );
}

const moduleEntries = await readdir(templateModuleRoot, { withFileTypes: true }).catch(() => []);
for (const entry of moduleEntries) {
  if (!entry.isDirectory()) {
    continue;
  }

  await validateModule(join(templateModuleRoot, entry.name), entry.name);
}

if (moduleEntries.filter((entry) => entry.isDirectory()).length === 0) {
  errors.push(`no modules found at ${templateModuleRoot}`);
}

await validateTemplateFiles();

if (errors.length > 0) {
  throw new Error(`Architecture check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

console.log("Architecture check passed");
