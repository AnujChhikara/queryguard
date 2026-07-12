# Adapters: Drizzle, Mongoose, Raw SQL — Design Spec

_Date: 2026-07-12._

**Relates to:** [QueryGuard Design Spec](2026-07-10-queryguard-design.md) (§4 adapters), [Query Anti-Pattern Catalog](2026-07-10-query-antipattern-catalog-design.md) (adapter contract, `QueryDescriptor`), [Business-Logic Context](2026-07-10-business-logic-context-design.md) (knowledge/cardinality path, deferred here).

## 1. Goal

Broaden QueryGuard's high-confidence coverage beyond Prisma to the three most
common data layers: **Drizzle**, **Mongoose**, and **raw SQL**. A "thin first
pass" — each new adapter populates the core signals (`operation`, `target`,
`hasFilter`, `hasLimit`, `isAggregate`) so the existing structural rules
(`n-plus-one`, `unbounded-read`) light up. Predicate-*value* extraction (which
powers `over-fetch`, cardinality silencing/escalation, and the driving-set trace)
is explicitly deferred to a per-adapter follow-up.

## 2. Scope

**In scope**
- Drizzle **relational API** (`db.query.<table>.findMany|findFirst({...})`).
- Mongoose model query methods (`Model.find(...)`, `findOne`, `countDocuments`, …).
- Raw SQL in `` sql`...` `` tagged templates and `.query()/.execute()/.raw()`
  calls whose first argument is a string/template literal.
- Confidence **`high`** for all three (N+1 findings are errors, matching Prisma).
- Per-adapter tests + engine integration tests + docs.

**Out of scope (explicit follow-ups)**
- Drizzle's **chained query builder** (`db.select().from(t).where(...).limit(...)`)
  and its `insert/update/delete` builders.
- **Predicate-value extraction** into `QueryDescriptor.filters[]` for the new
  adapters — so `over-fetch`, cardinality-based silencing/escalation, and the
  driving-set trace do **not** apply to non-Prisma code yet. N+1 stays a plain
  structural error; nothing is silenced-when-small. This preserves the identity
  guarantee: no knowledge file ⇒ new adapters only ever *add* structural findings.
- Full SQL parsing (an AST). Raw SQL uses a thin, regex-level read.
- Mongoose native-driver (`collection.find()`) beyond the model convention below.

## 3. Architecture

### 3.1 Broaden the adapter input from `CallExpression` to `Node`

Raw SQL lives in **tagged template expressions** (`` sql`SELECT ...` ``), which
are not `CallExpression`s. So:

- The engine collects **both** `CallExpression` and `TaggedTemplateExpression`
  nodes as adapter candidates (a new `findQueryCandidates(sf)` alongside the
  existing `findCallExpressions`, or an extension of it).
- The adapter type becomes `(node: Node) => QueryDescriptor | null`.
- Existing `prismaAdapter` / `heuristicAdapter` gain a one-line guard
  (`if (!Node.isCallExpression(node)) return null;`) — no behavior change.

### 3.2 Registration order (first match wins)

```ts
const adapters = [prismaAdapter, drizzleAdapter, mongooseAdapter, rawSqlAdapter, heuristicAdapter];
```

Structured adapters precede the heuristic fallback so real ORM calls get
high-confidence descriptors. Ordering is non-conflicting:
- Prisma requires two-level `base.model.method`; Mongoose's one-level
  `Model.method` falls through to the Mongoose adapter.
- Drizzle relational is a property-access chain `db.query.users.findMany`; raw
  SQL's `.query(...)` matches only when `query` is *invoked* with a string arg —
  no overlap.

## 4. Per-adapter detection

### 4.1 Drizzle (relational API)

- Shape: `base.query.<table>.findMany({...})` or `.findFirst({...})`.
  AST: call → PropertyAccess (name = `findMany`|`findFirst`) whose expression is
  PropertyAccess (name = `<table>`) whose expression is PropertyAccess
  (name = `query`) whose expression is an identifier/base.
- `operation: "read"` (relational API is read-only).
- `target`: `<table>`.
- `hasFilter`: first-arg object literal has a `where` property.
- `hasLimit`: first-arg object literal has a `limit` property.
- `isAggregate: false`. `confidence: "high"`. `db: "unknown"`, `orm: "drizzle"`.

### 4.2 Mongoose

- Read methods: `find`, `findOne`, `findById`, `countDocuments`,
  `estimatedDocumentCount`, `distinct`, `aggregate`, `exists`.
- Write methods: `create`, `insertMany`, `updateOne`, `updateMany`, `save`,
  `findOneAndUpdate`, `replaceOne`.
- Delete methods: `deleteOne`, `deleteMany`, `remove`, `findOneAndDelete`.
- **`Array.prototype.find` guard:** `.find` matches only when its first argument
  is an object literal **or absent** (never a function/arrow), preventing
  `arr.find(x => …)` false positives. The other methods aren't Array methods, so
  they're unambiguous.
- **Receiver convention:** the receiver must be a capitalized identifier
  (`User`) or a property access whose leaf ends in `Model` (`this.userModel`).
  `target` = receiver leaf name (`"User"`, `"userModel"`).
- `hasFilter`: a non-empty object-literal first argument (`findById` ⇒ always
  true). `hasLimit`: a chained `.limit(...)` follows the query in the same call
  chain (`Model.find(q).limit(10)`).
- `isAggregate`: `countDocuments`, `estimatedDocumentCount`, `aggregate`,
  `distinct`. `confidence: "high"`. `db: "mongodb"`, `orm: "mongoose"`.

### 4.3 Raw SQL

- Sources:
  - Tagged template `` sql`...` `` (tag identifier is `sql`).
  - `receiver.query(arg)`, `receiver.execute(arg)`, `receiver.raw(arg)` where the
    first argument is a string literal, no-substitution template, or template
    literal.
- SQL read (thin, regex-level, case-insensitive, on the concatenated text):
  - `operation`: leading keyword — `SELECT`/`WITH` ⇒ read, `INSERT`/`UPDATE` ⇒
    write, `DELETE` ⇒ delete, else `unknown`.
  - `target`: first identifier after `FROM` (read) / `INTO` (insert) / `UPDATE`.
  - `hasFilter`: matches `\bWHERE\b`.
  - `hasLimit`: matches `\bLIMIT\b`.
  - `isAggregate`: `SELECT` whose columns include `COUNT(`/`SUM(`/`AVG(`/`MIN(`/`MAX(`.
- If the text isn't recognizably SQL (no leading SQL keyword), return `null`
  (fall through). `confidence: "high"`. `db: "sql"`, `orm: "raw-sql"`.

## 5. Behavior — rules

**Lights up immediately (all three adapters):**
- `n-plus-one`: structural query-in-loop, **error** (high confidence). Inline
  hints and suppressions work unchanged (node/anchor based, adapter-agnostic).
- `unbounded-read`: read with `hasFilter === false && hasLimit === false`,
  aggregates excluded.

**Deferred (needs `filters[]` values + table facts):** `over-fetch`,
cardinality silencing/escalation, driving-set trace. For non-Prisma code these
never fire, so nothing is silenced on a guess.

## 6. Data model

No change to `QueryDescriptor`. `orm` gains the string values `"drizzle"`,
`"mongoose"`, `"raw-sql"` (the field is already `string`). `filters` remains
`undefined` for the new adapters in this slice.

## 7. Testing

- `test/adapters/drizzle.test.ts`, `mongoose.test.ts`, `raw-sql.test.ts` mirror
  the existing adapter-test style. Each covers positive detections and the key
  negatives:
  - Drizzle: builder form `db.select().from(users)` is **not** matched (deferred).
  - Mongoose: `arr.find(x => x.id)` is **not** a query; `Model.find().limit(10)`
    has `hasLimit === true`.
  - Raw SQL: `` sql`SELECT * FROM users` `` ⇒ unbounded-read; the same with
    `WHERE`+`LIMIT` is clean; a non-SQL template returns `null`.
- `test/engine.test.ts` additions: `n-plus-one` (error) and `unbounded-read`
  fire through each adapter; no regression to Prisma/heuristic or the identity
  guarantee.

## 8. Docs

- `docs/database-knowledge/`: short adapter notes (Drizzle, Mongoose, raw SQL)
  following `prisma.md`'s 7-field template, noting the relational-only / thin-SQL
  scope and the deferred value extraction.
- `README.md`: extend the adapter list and roadmap.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| `Array.prototype.find` false positives | First-arg-not-a-function guard + capitalized/`Model` receiver convention. |
| Broadening adapter input breaks existing adapters | One-line `isCallExpression` guard; existing tests must stay green (identity). |
| Raw-SQL regex misreads exotic SQL | Thin scope by design; unrecognized text ⇒ `null` (no false finding). Full parser is a documented follow-up. |
| Adapter ordering conflicts | Verified non-overlapping shapes (§3.2); heuristic stays last. |
