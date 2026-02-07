import { access, readFile } from "node:fs/promises";

const required = [
  "docs/vision.md",
  "docs/components-deep-dive.md",
  "docs/architecture.md",
  "decisions.md"
];

const errors = [];

for (const file of required) {
  try {
    await access(file);
  } catch {
    errors.push(`missing required file: ${file}`);
    continue;
  }

  const content = await readFile(file, "utf8");
  if (content.trim().length === 0) {
    errors.push(`file is empty: ${file}`);
  }
}

const decisions = await readFile("decisions.md", "utf8").catch(() => "");
if (!/^##\s+\d{4}-\d{2}-\d{2}\b/m.test(decisions)) {
  errors.push("decisions.md must contain at least one dated heading: '## YYYY-MM-DD'.");
}

if (errors.length > 0) {
  throw new Error(`Docs check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

console.log("Docs check passed");
