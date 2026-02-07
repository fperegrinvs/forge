import { access } from "node:fs/promises";

const required = [
  "docs/vision.md",
  "docs/components-deep-dive.md",
  "docs/architecture.md"
];

for (const file of required) {
  await access(file);
}

console.log("Docs check passed");
