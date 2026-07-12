# Context-Aware Adapters: Predicate-Value Extraction for Drizzle, Mongoose, Raw SQL

_Date: 2026-07-13._

**Relates to:** [Business-Logic Context](2026-07-10-business-logic-context-design.md)
(cardinality / over-fetch / driving-set), [Adapters](2026-07-12-adapters-drizzle-mongoose-rawsql-design.md)
(the thin first pass that these deepen).

## 1. Goal

Make the knowledge file's superpowers - **over-fetch**, small-loop **silencing**,
large-loop **escalation**, and the **driving-set** trace - work for **Drizzle,
Mongoose, and raw SQL**, not just Prisma. Today those rules are Prisma-only
because only the Prisma adapter populates `QueryDescriptor.filters[]` with
predicate *values*. This universalizes Cardinal's differentiator.

## 2. The contract (why this is adapter-only work)

The downstream consumers are already adapter-agnostic:

- `estimateCardinality(d, k)` builds a map of the query's `kind:"eq"` predicates
  that have a concrete `value`, then matches a table's filter facts when every
  `when` key/value is a subset of the query's eq predicates (the query is a
  *superset* of the fact). It picks the tightest matching fact.
- `over-fetch`, small/large loop bounds (`resolveDrivingSet` → `estimateCardinality`)
  all flow from `filters[]` + `hasFilter` + `target`.

So the **only** work is teaching each adapter to emit `filters[]` the way Prisma
already does. **No engine or rule changes.**

`QueryFilter` (unchanged): `{ field: string; value?: string | number | boolean; kind: "eq" | "in" | "other" }`.

**What actually matters for matching:** `eq` predicates with a concrete literal
value, AND-connected. `in` is marked (`kind:"in"`) but not value-matched.
Everything else (`or`, ranges, function calls, non-literal values) becomes
`kind:"other"` or an eq with `value: undefined` - present but non-matching, exactly
as Prisma treats a non-literal `where`.

## 3. Per-adapter extraction

### 3.1 Drizzle (relational API)

`where` is an operator-function expression, e.g.
`and(eq(users.status, "active"), inArray(users.id, ids))`.

- Unwrap `and(...)` → flatten each argument (recurse).
- `eq(col, literal)` → `{ field, value, kind:"eq" }`. `field` = the column's leaf
  name: `users.status` (PropertyAccess) → `"status"`; a bare identifier → its text.
  A non-literal second arg → `value: undefined`.
- `inArray(col, ...)` → `{ field, kind:"in" }`.
- `or(...)`, `not(...)`, `ne`/`gt`/`gte`/`lt`/`lte`/`like`/`ilike`/anything else →
  `{ field?, kind:"other" }` (recurse `or` args only to collect field names if
  cheap; otherwise skip). These never contribute to a superset match.

### 3.2 Mongoose

`filter` is an object literal with Mongo operators, e.g.
`{ status: "active", age: { $gt: 5 }, id: { $in: [...] } }`.

- `{ field: <literal> }` → eq.
- `{ field: { $eq: <literal> } }` → eq.
- `{ field: { $in: [...] } }` → `in`.
- `{ field: { $gt|$lt|$ne|$regex|... } }` → `other`.
- `$and: [ ... ]` → flatten. `$or`/`$nor` → `other`.

This is nearly identical to Prisma's `extractFilters` (object-literal walk); a
shared helper is extracted where it reads cleanly, but the `$`-operator handling
is Mongoose-specific.

### 3.3 Raw SQL

Parse the WHERE clause with `node-sql-parser` (already a core dependency) and walk
the `where` AST:

- `binary_expr` op `"="` with `column_ref` left + literal right
  (`single_quote_string` / `number` / boolean) → eq.
- op `"AND"` → recurse both sides.
- op `"IN"` → `in` (left column).
- op `"OR"`, `"LIKE"`, comparisons, function calls → `other`.

**Interpolation:** template SQL like `` sql`... WHERE id = ${x}` `` is normalized
before parsing (the `${…}` join-count work). The placeholder must be a
**recognizable sentinel** (not a real-looking literal like `1`) so an interpolated
value is extracted as `kind:"eq", value: undefined` (unknown), never a fake literal
that could wrongly match a fact. The sentinel is shared with the existing
`countSqlJoins` normalization in `sql/parse.ts`.

## 4. Behavior after this change

With a `cardinal.knowledge.yaml` present, **all four high-confidence adapters**
now get:

- `over-fetch` (unfiltered read on a large table with a selective filter fact),
- small-loop **silencing** and large-loop **escalation** via the driving-set trace,
- cardinality-aware `n-plus-one` severity.

With no knowledge file, output is unchanged (identity guarantee holds: `filters[]`
is only consumed when a knowledge file is loaded).

## 5. Data model

No `QueryDescriptor` or `QueryFilter` change. `filters[]` moves from `undefined`
to populated for the three adapters. `sql/parse.ts` gains a small
`extractSqlFilters(text)` alongside `countSqlJoins`, and its normalization sentinel
is factored so both share it.

## 6. Testing

- **Per-adapter filter tests** (`drizzle`/`mongoose`/`raw-sql` test files): assert
  `d.filters` for representative predicates (eq literal, `in`, range→other,
  AND-flattening, interpolated→unknown).
- **Engine integration** (`engine.test.ts`): with a knowledge file, over-fetch and
  small-loop silencing fire through each adapter (mirroring the existing Prisma
  cases). Confirm the no-knowledge identity guarantee is unaffected.

## 7. Out of scope

- Column-level over-fetch (`select`/projection). Row cardinality only, as before.
- Deep boolean reasoning over `or`/`not` (treated as `other`).
- Full SQL expression coverage (functions, subquery predicates) - `other`.
- Drizzle's chained query builder (`db.select()...`) - still deferred.
