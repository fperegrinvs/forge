# @forge/guidance-pack

Bundled guidance assets (AGENTS/rules/skills) and installer logic used by Forge Desktop (via the internal sidecar).

## Commands

From the repo root:

```bash
bun run --filter @forge/guidance-pack build
bun run --filter @forge/guidance-pack test
bun run --filter @forge/guidance-pack typecheck
```

Repo-level workflow assets are generated from policy:

```bash
bun run workflow:sync
bun run workflow:check-sync
```
