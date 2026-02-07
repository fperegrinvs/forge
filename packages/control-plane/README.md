# @forge/control-plane

Execution orchestrator for Forge plans. Selects runnable tasks, delegates to adapters, runs task-type checks, and writes evidence under `.forge/`.

## Commands

From the repo root:

```bash
bun run --filter @forge/control-plane build
bun run --filter @forge/control-plane test
bun run --filter @forge/control-plane typecheck
```

