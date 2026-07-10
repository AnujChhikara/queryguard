# QueryGuard — Query Anti-Pattern Catalog v1 — Design Spec

**Date:** 2026-07-10
**Status:** Approved design (pending written-spec review), then implementation plan
**Relates to:** [QueryGuard Design Spec](2026-07-10-queryguard-design.md) (§4 adapters/rules, §5 rule set), [Database Knowledge Base](2026-07-10-database-knowledge-base-design.md)

---

## 1. Problem & Purpose

Today QueryGuard detects exactly one pattern (N+1) for exactly one ORM (Prisma).
That makes it a one-trick tool. The point of the product is to catch *the many
ways a database query goes wrong* — and to name each issue precisely, not wave
vaguely at "some query." This project turns the engine into a **catalog of query
anti-pattern rules on a shared recognition foundation**, with N+1 as one rule
among several.

Two guiding corrections drive this design:

1. **Know the ORM, name the issue.** We do not want a fuzzy "ORM-agnostic"
   detector that can only guess. Each ORM gets a **precise per-ORM adapter** that
   understands that ORM's query shape, so a rule can say exactly what is wrong and
   how to fix it. Precision scales with how well we know the caller.
2. **No ORM ≠ no help.** When no ORM adapter matches (raw SQL, a custom
   data-access layer), a **heuristic fallback** still recognizes query-like calls
   and surfaces warnings — so teams not using an ORM are not left blind.

Precision-first remains the law (spec's guiding principle): *a linter that cries
wolf gets disabled the same day.* Known facts are errors; inferred facts are
confidence-tagged warnings.

---

## 2. Scope

### In scope (this catalog slice)
- **Foundation:**
  - A **richer `QueryDescriptor`** (adds `hasLimit`, `hasFilter`, `confidence`).
  - A **rule registry** (formalize the existing `rules[]` seam so each rule is an
    independent, registered consumer).
  - A **heuristic fallback adapter** for no-ORM / custom data-access code.
- **Rules (2):**
  - `query-in-loop` (N+1 family — reads *and* writes in loops).
  - `unbounded-read` (read with **neither** a filter **nor** a limit — a
    full-scan-no-limit; high-signal because it requires *both* clauses absent).
- Positive + negative fixtures per rule; a `docs/database-knowledge/` entry per
  rule (fleshes the adjacent-anti-pattern stubs already left in `prisma.md`).

### Out of scope (explicit follow-ups)
- **`over-fetch` as its own rule.** A purely syntactic trigger ("read has no
  `select`") is too noisy — most reads legitimately omit `select`. A precise
  version needs data-flow (is the fetched row actually used narrowly?) or config.
  Deferred to a follow-up. `selectedFields` stays on the descriptor for it.
- **Separate `missing-limit` / `missing-filter` rules.** Firing on the mere
  absence of one clause flags legitimate queries (a `findUnique` by id has a
  filter but no limit; a small-table `findMany` has neither by design). They are
  replaced here by the single, higher-signal `unbounded-read` (both clauses
  absent). Splitting them out again, if ever, belongs with data-flow/config.
- Adapters for other ORMs (Mongoose, Drizzle, Sequelize, TypeORM, Knex). The
  architecture is built for them; this slice ships **Prisma + heuristic** only.
- A `queryguard.config` file to promote heuristic warnings to errors or
  enable/disable rules. Deferred to its own spec.
- Schema-aware checks (un-indexed field, wrong index) — need a schema source; v2.
- Generic argument-shape inference for heuristic (non-ORM) descriptors — see §5.2.
- Any VS Code extension change (none needed — see §6).

---

## 3. Architecture

The engine already runs a list of adapters (first match wins) and a list of
rules. This slice deepens both.

```
recognition (adapters, first match wins)          rules (all run)
  prismaAdapter        -> precise descriptor  ┐
  heuristicAdapter     -> structural descriptor├─> query-in-loop
  (future: mongoose,                          │    over-fetch
   drizzle, sequelize...)                      │    missing-limit
                                               ┘    missing-filter
```

- **Per-ORM adapters** produce a *fully-populated* `QueryDescriptor` — they know
  the argument shape, so `selectedFields`, `hasLimit`, `hasFilter` are reliable.
  `confidence: "high"`.
- **`heuristicAdapter`** is the fallback (runs last): it recognizes a query-like
  call but cannot reliably know arguments, so it populates only structural fields
  (`inLoop`, `awaited`, `operation: "unknown"`) and sets `confidence: "heuristic"`;
  `hasLimit`/`hasFilter`/`selectedFields` are left `undefined` (meaning "unknown").
- **Rules** consume descriptors and decide severity from `confidence` and from
  whether the field they need is *known* (defined) vs *unknown* (`undefined`).

### 3.1 `QueryDescriptor` (extended)

```ts
export interface QueryDescriptor {
  db: string;
  orm: string;                       // "prisma" | "heuristic" | (future ORMs)
  operation: "read" | "write" | "delete" | "unknown";
  target: string;                    // model/table/receiver name for the message
  selectedFields?: string[];         // undefined = unknown; [] = "no projection"
  hasLimit?: boolean;                // undefined = unknown (heuristic)
  hasFilter?: boolean;               // undefined = unknown (heuristic)
  node: Node;
  inLoop: boolean;
  awaited: boolean;
  confidence: "high" | "heuristic";
}
```

The `undefined` vs `false` distinction is load-bearing: a shape rule fires only
when it *knows* the shape (field is `false`), never when it is `undefined`
(unknown). This is what keeps heuristic/no-ORM code from producing false shape
errors.

---

## 4. The heuristic fallback adapter

Recognizes a `CallExpression` as a query-like call iff **all**:

1. It is directly `await`ed (parent is an `AwaitExpression`). Strongest
   false-positive guard: synchronous `array.find/.filter/.map` are never awaited;
   real DB calls are async.
2. Callee is a property access `<receiver>.<method>` (not a bare `getUser(id)`).
3. `method` ∈ QUERY_VERBS **or** `receiver` ∈ DATA_SOURCE_NAMES:
   - QUERY_VERBS: `find, findOne, findById, findMany, get, getBy, retrieve,
     fetch, query, select, aggregate, count, list, search, load, lookup, exists`
   - DATA_SOURCE_NAMES: `db, database, repo, repository, model, models, dao,
     dataAccess, store, collection, knex, prisma, mongoose, sequelize, em,
     entityManager`
4. `method` ∉ BLOCKLIST: `map, forEach, filter, reduce, some, every, flatMap,
   slice, concat, join, keys, values, entries, has, add, then, catch, finally,
   json, send, status, end` (Array/Map/Promise/Express `res.*` guards).

Produces `{ confidence: "heuristic", operation: "unknown", inLoop, awaited,
selectedFields/hasLimit/hasFilter: undefined }`. Runs **after** all per-ORM
adapters so a real Prisma call is claimed by `prismaAdapter` first (no
double-count).

---

## 5. The rules

### 5.1 `query-in-loop` (N+1 family) — works on ALL descriptors
- **Rule id stays `n-plus-one`** (the shipped id, referenced by the knowledge
  base and `docsUrl`); we broaden its behavior rather than rename it, to avoid
  breaking existing references. "query-in-loop" is its descriptive name.
- Fires when `descriptor.inLoop`.
- Covers reads **and** writes/deletes (a write per iteration should be a batch
  `createMany`/`updateMany`).
- Severity: `confidence === "high"` → **error**; `confidence === "heuristic"` →
  **warning** (this is the rule that catches the custom `dataAccess.retrieveUsers`
  no-ORM case).
- Message names the operation and target and suggests batching.

### 5.2 `unbounded-read` — precise-adapter descriptors only
- Fires when **all**: `operation === "read"`, `hasFilter === false`, **and**
  `hasLimit === false`. Requiring *both* clauses absent is what makes it
  high-signal: a full read with no `where` and no `take` is very likely an
  unbounded full-table/collection scan.
- Fires **only when both fields are known** (`false`), never when `undefined`.
  Heuristic (no-ORM) descriptors leave them `undefined`, so no-ORM code never
  triggers this rule — it only gets `query-in-loop`.
- Severity: **warning**.
- Preserves the canonical good example: `prisma.user.findMany({ where: { id: {
  in: ids } } })` has a filter (`hasFilter === true`) → not flagged.
- Adding another ORM adapter later lights this rule up for that ORM with no rule
  changes.

### 5.3 Prisma adapter changes
Populate the new fields by inspecting the call's first options object literal:
- `hasLimit`: whether a `take` property is present.
- `hasFilter`: whether a `where` property is present.
- `selectedFields`: keys of a `select` object when present, else `[]` (kept for
  the deferred `over-fetch` rule; no rule consumes it in this slice).
- `confidence: "high"`.

---

## 6. What does not change

The VS Code extension already maps `error → red` and `warning → yellow` and
re-runs on every edit. The entire catalog therefore surfaces in-editor with **no
extension changes**: Prisma-in-loop shows red, everything else shows yellow.

---

## 7. Error handling & resilience

- Per-rule try/catch already isolates a throwing rule (engine). Each new rule
  inherits it.
- Adapters return `null` on anything they don't recognize; unknown shapes yield
  `undefined` fields, never a guess.
- Best-effort parsing unchanged: a mid-typing/unparsable file yields no
  diagnostics, never a throw.

---

## 8. Testing

- **Per rule:** positive + negative fixtures.
  - `query-in-loop`: Prisma read-in-loop → error; the real-world custom
    `dataAccess.retrieveUsers` in `.map` → warning; a write-in-loop → flagged; a
    single awaited query (no loop) → nothing; `array.find(...)`/`res.json(...)` →
    nothing.
  - `unbounded-read`: Prisma read with neither `where` nor `take` → warning; the
    same read with a `where` (or a `take`) → nothing; the canonical batched
    `findMany({ where: { id: { in } } })` → nothing; a heuristic (no-ORM) call →
    nothing (fields unknown).
- **Regression:** existing Prisma N+1 stays an **error**.
- **Knowledge base:** each rule's fixtures trace to its `docs/database-knowledge/`
  entry; false-positive notes feed the FP corpus.

---

## 9. Success Criteria

- The custom `dataAccess.retrieveUsers`-in-`.map` snippet produces a **warning**
  (no-ORM path proven).
- A Prisma read in a loop is an **error**; a Prisma read with neither `where` nor
  `take` produces an `unbounded-read` **warning**; the canonical batched
  `findMany({ where: { id: { in } } })` produces nothing.
- No-ORM code never produces an `unbounded-read` diagnostic (no false shape
  claims).
- Adding a hypothetical second ORM adapter would light up both rules for it with
  zero rule-code changes (extensibility proven by construction).

---

## 10. Risks

- **Heuristic false positives** — mitigated by the `await`-required guard, the
  property-access requirement, and the Array/Map/Promise/`res.*` blocklist; and by
  emitting only **warnings**, never errors, on heuristic matches.
- **Shape-rule noise** — the reason `unbounded-read` requires *both* `hasFilter`
  and `hasLimit` to be known `false`: a single-clause trigger flags legitimate
  queries. Fires only on *known* fields, at **warning** severity. Over-fetch
  (single-clause, noisy) is deferred for this reason.
- **Catalog coherence** — all rules consume one descriptor contract; the
  `undefined` = unknown convention is the single rule every consumer must respect.
