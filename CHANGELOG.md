# Changelog

## 0.1.0 — 2026-07-12

First release.

- **Engine** — six rules: `n-plus-one`, `unbounded-read`, `over-fetch`,
  `order-by-rand`, `leading-wildcard-like`, `excessive-joins`.
- **Adapters** — Prisma, Drizzle (relational API), Mongoose, and raw SQL
  (parsed with `node-sql-parser`), plus a heuristic fallback.
- **Knowledge file** (`cardinal.knowledge.yaml`) — cardinality-aware silencing of
  small loops, escalation of large fan-out, `over-fetch`, inline hints, and
  anchored suppressions.
- **Config file** (`cardinal.config.json` / `.yaml`) — per-rule severity or
  `off`.
- **CLI** (`@cardinal/cli`) — `cardinal <glob>`, `cardinal suppress`,
  `--knowledge` / `--no-knowledge` / `--no-config`.
- **VS Code extension** — live diagnostics, knowledge- and config-aware, and a
  suppression quick-fix.

100% static: no LLM, no network, no database connection.
