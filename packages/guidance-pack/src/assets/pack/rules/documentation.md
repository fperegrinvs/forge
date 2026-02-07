# Documentation Rules

- require_docs_updates: true
- Update docs whenever implementation changes behavior or interfaces.
- Record rationale in decision notes and decisions.md.
Run gate:docs with: bun run docs:check

Allowed documentation update globs:
- docs/**/*.md
- decisions.md
