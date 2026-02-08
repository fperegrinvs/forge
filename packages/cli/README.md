# @forge/cli

The public `forge` CLI. Wraps contracts/control-plane/templates and provides plan/workflow commands.

## Notes

- `forge install-guidance` installs guidance files into the current working directory and writes best-effort pack source metadata to `.forge/guidance.json` (when the pack has a `manifest.json`).
- `forge run next --adapter codex` performs a lightweight preflight that syncs Codex-native skills from `skills/*/SKILL.md` into `.agents/skills/*/SKILL.md` before running tasks.

## Commands

From the repo root:

```bash
bun run --filter @forge/cli build
bun run --filter @forge/cli test
bun run --filter @forge/cli typecheck
```

Run the CLI (after building):

```bash
bun packages/cli/dist/bin.js --help
```
