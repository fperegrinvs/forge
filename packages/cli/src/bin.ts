#!/usr/bin/env node
import { CliExit, runCli } from "./cli.js";

runCli(process.argv).catch((error: unknown) => {
  if (error instanceof CliExit) {
    process.exit(error.code);
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
