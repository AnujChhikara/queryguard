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
| **Drizzle** | high | read-only | table | ✅ (`where`) | ✅ (`limit`) | ✅ (`eq`/`inArray`/`and`) | — |
| **Mongoose** | high | ✅ | model | ✅ | ✅ (chained `.limit()`) | ✅ (`$in`/`$eq`/`$and`) | ✅ |
| **Raw SQL** | high | ✅ | `FROM`/`INTO`/`UPDATE` table | ✅ (`WHERE`) | ✅ (`LIMIT`) | ✅ (parsed `WHERE`) | ✅ |
| **Heuristic** | heuristic | unknown | method name | ⛔ | ⛔ | ⛔ | ⛔ |

All four high-confidence adapters extract predicate **values** into `filters[]`,
so the knowledge-driven rules (`over-fetch`, cardinality silencing/escalation, the
driving-set trace) work across Prisma, Drizzle, Mongoose, and raw SQL. Only
AND-connected `eq` predicates with a concrete literal value participate in fact
matching; `in` is marked, and `or`/ranges/interpolated values are non-matching.

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
- **Structural signals use a real SQL parser** (`node-sql-parser`): JOIN clauses
  are counted from the AST (feeding `excessive-joins`), accurate where a regex
  would miscount JOINs inside comments or string literals. Parse failures (exotic
  dialects, unresolved `${…}` interpolations) fall back to 0 — never a false
  finding.
- **Operation/target/filter/limit are still regex-thin:** leading keyword →
  `operation` (SELECT/WITH→read, INSERT/UPDATE→write, DELETE→delete); first table
  after `FROM`/`INTO`/`UPDATE` → `target`; `\bWHERE\b`/`\bLIMIT\b` →
  `hasFilter`/`hasLimit`; `COUNT(`/`SUM(`/… → `isAggregate`. Unrecognized text
  returns nothing (no false finding). A full SQL parser is a documented follow-up.

## Deferred

- Drizzle's chained query builder (`db.select()…`) and write builders.
- Column-level over-fetch (projection / `select`) — row cardinality only.
- Raw SQL still reads `operation`/`target` with a thin regex (only `WHERE` and
  JOINs go through the parser); deeper `or`/subquery predicate reasoning is a
  follow-up.
