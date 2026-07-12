# Adapters — Detection Coverage

_Last checked against source: 2026-07-12._

An **adapter** turns a source-level query call into a normalized
`QueryDescriptor` the rules consume. This note records what each adapter
recognizes and the current scope limits. Anti-pattern definitions themselves
live in [`prisma.md`](prisma.md); adapters just detect those shapes across
different data layers.

## Coverage matrix

| Adapter | Confidence | `operation` | `target` | `hasFilter` | `hasLimit` | `filters[]` values | Aggregates |
|---------|-----------|-------------|----------|-------------|------------|--------------------|-----------|
| **Prisma** | high | ✅ | model | ✅ | ✅ (`take`) | ✅ (eq/in/other) | ✅ |
| **Drizzle** | high | read-only | table | ✅ (`where`) | ✅ (`limit`) | ⛔ deferred | — |
| **Mongoose** | high | ✅ | model | ✅ | ✅ (chained `.limit()`) | ⛔ deferred | ✅ |
| **Raw SQL** | high | ✅ | `FROM`/`INTO`/`UPDATE` table | ✅ (`WHERE`) | ✅ (`LIMIT`) | ⛔ deferred | ✅ |
| **Heuristic** | heuristic | unknown | method name | ⛔ | ⛔ | ⛔ | ⛔ |

Only Prisma extracts predicate **values** into `filters[]`, so the
knowledge-driven rules (`over-fetch`, cardinality silencing/escalation, the
driving-set trace) apply to Prisma only. For the other adapters, `n-plus-one`
and `unbounded-read` fire structurally; nothing is silenced on a guess.

## Drizzle

- **Detects:** the relational query API — `db.query.<table>.findMany({...})` and
  `.findFirst({...})`. `target` is `<table>`; `hasFilter`/`hasLimit` come from the
  options object's `where`/`limit` keys.
- **Not yet:** the chained query builder (`db.select().from(t).where(...).limit(...)`)
  and the `insert/update/delete` builders. These are a documented follow-up.

## Mongoose

- **Detects:** model query methods — reads (`find`, `findOne`, `findById`,
  `countDocuments`, `estimatedDocumentCount`, `distinct`, `aggregate`, `exists`),
  writes (`create`, `insertMany`, `updateOne`, `updateMany`, `save`,
  `findOneAndUpdate`, `replaceOne`), deletes (`deleteOne`, `deleteMany`, `remove`,
  `findOneAndDelete`). `hasLimit` follows a chained `.limit(n)`.
- **Receiver convention:** the receiver must be a capitalized identifier (`User`)
  or end in `Model` (`this.userModel`).
- **False-positive guard:** `Model.find(cb)` vs `Array.prototype.find(cb)` — `.find`
  is skipped when its first argument is a function/arrow, so `arr.find(x => …)` is
  never treated as a query.

## Raw SQL

- **Detects:** `` sql`...` `` tagged templates and `receiver.query|execute|raw(<sql>)`
  calls whose first argument is a string or template literal. A
  `db.execute(sql`...`)` reports once (the call form wins; the inner template is
  skipped) to avoid double-counting.
- **SQL read is regex-thin, not a parser:** leading keyword →
  `operation` (SELECT/WITH→read, INSERT/UPDATE→write, DELETE→delete); first table
  after `FROM`/`INTO`/`UPDATE` → `target`; `\bWHERE\b`/`\bLIMIT\b` →
  `hasFilter`/`hasLimit`; `COUNT(`/`SUM(`/… → `isAggregate`. Unrecognized text
  returns nothing (no false finding). A full SQL parser is a documented follow-up.

## Deferred (all non-Prisma adapters)

- Predicate-**value** extraction into `filters[]` (unlocks `over-fetch`,
  cardinality, driving-set for these ORMs).
- Drizzle chained builder + write builders.
- Full SQL parsing.
