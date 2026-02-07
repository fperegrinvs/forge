import { access } from "node:fs/promises";

const required = ["docs/architecture.md", "decisions.md"];

for (const file of required) {
  await access(file);
}

console.log("Docs check passed");
