# Contributing

## Branching Policy (Required)

- Do not commit or push directly to `main`.
- Always work on a topic branch under `codex/*` and open a PR.

Recommended repo settings:

- Enable branch protection on `main` (require PRs + require CI status checks).

## Start Work (Always)

```bash
git fetch origin
git switch -c codex/<topic> origin/main
```

If you already have a branch, keep it current:

```bash
git fetch origin
git rebase origin/main
```

## Local Gates

Install repo-managed git hooks (recommended):

```bash
bun run hooks:install
```

Run the full local verify:

```bash
bun run verify
```
