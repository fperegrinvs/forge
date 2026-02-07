import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exists } from "@forge/shared-utils";

const baseDir = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(baseDir, "assets");

type ScaffoldOptions = {
  withContractTest?: boolean;
  withPropertyTest?: boolean;
};

function toPascalCase(input: string): string {
  return input
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

async function renderTemplate(path: string, values: Record<string, string>): Promise<string> {
  const source = await readFile(path, "utf8");
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{{${key}}}`, value),
    source
  );
}

export async function initProject(projectName: string, targetRoot: string): Promise<string> {
  const source = join(assetsDir, "forge-template");
  const destination = join(targetRoot, projectName);

  if (await exists(destination)) {
    throw new Error(`Project directory already exists: ${destination}`);
  }

  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
  return destination;
}

export async function scaffoldModule(
  moduleName: string,
  projectRoot: string,
  options: ScaffoldOptions = {}
): Promise<string[]> {
  const pascalName = toPascalCase(moduleName);
  const moduleRoot = join(projectRoot, "modules", moduleName);

  if (await exists(moduleRoot)) {
    throw new Error(`Module already exists: ${moduleName}`);
  }

  await mkdir(join(moduleRoot, "services"), { recursive: true });
  await mkdir(join(moduleRoot, "domain"), { recursive: true });
  await mkdir(join(moduleRoot, "infrastructure"), { recursive: true });

  const created: string[] = [];
  const write = async (relativePath: string, templateName: string): Promise<void> => {
    const content = await renderTemplate(join(assetsDir, "module", templateName), {
      name: moduleName,
      pascalName
    });
    const fullPath = join(moduleRoot, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
    created.push(fullPath);
  };

  await write("index.ts", "index.ts.tpl");
  await write("routes.ts", "routes.ts.tpl");
  await write("container.ts", "container.ts.tpl");
  await write(`services/${moduleName}.service.ts`, "service.ts.tpl");
  await write("domain/types.ts", "domain-types.ts.tpl");
  await write(`infrastructure/${moduleName}.repository.ts`, "repository.ts.tpl");

  if (options.withContractTest ?? true) {
    const contractFile = join(projectRoot, "contracts", `${moduleName}.contract.test.ts`);
    await mkdir(dirname(contractFile), { recursive: true });
    await writeFile(contractFile, `describe("${moduleName} contract", () => {});\n`, "utf8");
    created.push(contractFile);
  }

  if (options.withPropertyTest ?? true) {
    const propertyFile = join(projectRoot, "tests", `${moduleName}.property.test.ts`);
    await mkdir(dirname(propertyFile), { recursive: true });
    await writeFile(propertyFile, `describe("${moduleName} property tests", () => {});\n`, "utf8");
    created.push(propertyFile);
  }

  return created;
}
