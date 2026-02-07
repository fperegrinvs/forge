import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const requiredModuleFiles = ["index.ts", "routes.ts", "container.ts"];
const modulesRoot = resolve("modules");
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

const moduleEntries = await readdir(modulesRoot, { withFileTypes: true }).catch(() => []);
for (const entry of moduleEntries) {
  if (!entry.isDirectory()) {
    continue;
  }

  await validateModule(join(modulesRoot, entry.name), entry.name);
}

if (moduleEntries.filter((entry) => entry.isDirectory()).length === 0) {
  errors.push(`no modules found at ${modulesRoot}`);
}

if (errors.length > 0) {
  throw new Error(`Architecture check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

console.log("Architecture check passed");
