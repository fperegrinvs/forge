import { syncWorkflowAssets } from "./sync-workflow-assets.mjs";

syncWorkflowAssets({ check: true })
  .then(() => {
    process.stdout.write("Workflow assets are in sync\n");
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
