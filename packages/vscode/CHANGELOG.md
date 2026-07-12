# Changelog

## 0.1.0

First release.

- Live diagnostics for TypeScript/JavaScript/TSX/JSX: `n-plus-one`,
  `unbounded-read`, `over-fetch`, `order-by-rand`, `leading-wildcard-like`,
  `excessive-joins`.
- Adapters for Prisma, Drizzle, Mongoose, and raw SQL.
- Reads `cardinal.knowledge.yaml` (data-scale aware) and `cardinal.config`
  (rule on/off + severity), and re-lints live when either changes.
- Suppression **quick-fix** on any squiggle: optional reason, and an offer to
  record an implied cardinality fact.
- 100% static — no LLM, no network, no database connection.
