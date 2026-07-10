# QueryGuard — Business-Logic Context v1 — Design Spec

**Date:** 2026-07-10
**Status:** Approved design (pending written-spec review), then implementation plan
**Relates to:** [QueryGuard Design Spec](2026-07-10-queryguard-design.md) (§4 adapters/rules, §5 rule set), [Query Anti-Pattern Catalog](2026-07-10-query-antipattern-catalog-design.md) (resolves its deferred `over-fetch`), [Database Knowledge Base](2026-07-10-database-knowledge-base-design.md)

---

## 1. Problem & Purpose

Every rule QueryGuard ships today reasons only about what is *syntactically* in
the code: is there a `where`? a `take`? a loop? It has **zero knowledge of the
actual data**. So it cannot tell the difference between the two cases that matter
most to a real team:

- `for (const u of activeUsers) { … }` where `activeUsers` is ~10 rows — **fine**,
  yet flagged today as an N+1 error.
- `for (const u of allUsers) { … }` where `allUsers` is ~10,000 rows — **a real
  fire**, yet flagged with the same generic message as the harmless case.

Generic linters (and generic LLMs) give generic advice because they lack this
context. The selling point of this feature is that a team declares its
**business-logic / cardinality facts once**, in a small structured file, and
QueryGuard's warnings become *project-aware*: it silences the harmless cases,
escalates the dangerous ones, and proactively suggests narrower queries.

This is a **100% static** capability. There is no LLM, no network, and no
database connection in the analysis path. The knowledge file is authored by a
human and read deterministically. This preserves the product's core promise —
*your code never leaves your machine, and results are reproducible in CI.*

### Guiding principle (unchanged): precision-first

*A linter that cries wolf gets disabled the same day.* One corollary drives the
whole safety posture here: **it is worse to silence a real N+1 than to leave a
harmless one flagged.** Therefore the engine only silences a warning when it can
**prove** the driving set is small from an unambiguous trace; every uncertain
case falls back to today's exact behavior.

---

## 2. Scope

### In scope (v1)
- A **knowledge file** (`queryguard.knowledge.yaml` / `.json`), opt-in, discovered
  by walking up from the analyzed file. Absent → today's behavior, unchanged.
- **Filter-predicate extraction** in the Prisma adapter (`where: {status:'active'}`
  → `status=active`), added alongside the existing `hasFilter` boolean.
- A **cardinality estimator** and a **conservative driving-set linker** (two small,
  independently testable modules).
- **Three knowledge-driven behaviors**, delivered by threading cardinality into
  `RuleContext`:
  1. **Silence false positives** — provably-small loop/IN driving set → suppress
     or downgrade `n-plus-one`.
  2. **Escalate real fan-out** — provably-large driving set → raise severity and
     quantify the message.
  3. **Suggest narrower reads** — a new `over-fetch` rule for unfiltered reads on a
     table with a known highly-selective filter.
- **Inline hints** as the explicit fallback: `// queryguard: bounded [n]` /
  `// queryguard: unbounded`.
- A **suppression mechanism** (§11): an interactive `queryguard suppress
  <file>:<line>` command that silences *any* diagnostic (warning or error),
  records a precise, line-drift-resilient suppression plus an optional reason into
  the knowledge file, and offers to promote an implied cardinality fact (never
  automatically). The analysis engine honors recorded suppressions.
- Positive + negative fixtures per behavior; a `docs/database-knowledge/` note for
  the knowledge-file format and the `over-fetch` rule.

### Out of scope (explicit follow-ups)
- **Column-level over-fetch** (fetching all *columns* when few are used). Real, but
  a distinct feature; v1 is **row cardinality only**. `selectedFields` stays on the
  descriptor for it.
- **Aggressive tracing** across reassignments, `.filter()`/`.map()` chains, and
  helper functions. v1 traces only the single-assignment, same-function case; the
  rest is handled by inline hints.
- **LLM-assisted authoring** of the knowledge file (prose → structured facts).
  Possible later phase; does not affect the static analysis path.
- **Interactive suppression inside the VS Code extension** (a "suppress + why?"
  quick-fix). v1 ships the interactive flow in the **CLI** (`queryguard suppress`);
  the editor quick-fix reuses the same storage + engine plumbing in a later phase.
- Adapters for other ORMs. The knowledge model is ORM-agnostic (keyed by table +
  predicate), but v1 wires predicate extraction into the **Prisma adapter only**;
  the heuristic adapter continues to emit `unknown` cardinality.

---

## 3. The knowledge file

**Location & discovery.** `queryguard.knowledge.yaml` (or `.yml` / `.json`) at the
project root. The CLI discovers it by walking up the directory tree from the first
analyzed file (or cwd), like `tsconfig.json` resolution. First match wins. Missing
file is not an error — the engine simply runs with no knowledge.

**Schema (v1).**

```yaml
version: 1
tables:
  user:
    rows: 10000                 # approximate total row count
    filters:
      - when: { status: active }   # predicate -> selectivity
        rows: 10
      - when: { status: deleted }
        rows: 500
  contact:
    rows: 10                     # bounded by active users, per domain logic
thresholds:                     # optional; defaults below if omitted
  small: 50                     # count <= small  -> "small" bound  (silence)
  large: 1000                   # count >= large  -> "large" bound  (escalate)
```

Field semantics:
- `tables.<name>.rows` — estimated cardinality of the whole table (no filter).
- `tables.<name>.filters[]` — each entry maps an **equality predicate set**
  (`when`) to an estimated row count. v1 matches equality predicates only; a query
  whose extracted filters are a **superset** of a `when` entry inherits that
  entry's `rows` (more filters can only shrink the result, so borrowing the
  matched entry's count is a safe upper bound). Non-equality predicates (`in`,
  ranges) are ignored for matching in v1 and yield `unknown`.
- `thresholds.small` / `thresholds.large` — bucket boundaries. Defaults: `small`
  = 50, `large` = 1000. A count strictly between the two is `medium` (neither
  silenced nor escalated; today's behavior).

**Loading.** Core exports `loadKnowledge(path): Knowledge | null` and a
`discoverKnowledge(fromPath): Knowledge | null`. Parse failures (bad YAML, wrong
`version`, malformed entries) produce a **single non-fatal diagnostic** ("knowledge
file ignored: <reason>") and the engine proceeds as if absent — a broken config
never breaks the linter.

---

## 4. Descriptor enrichment (adapter changes)

`QueryDescriptor` gains one field; the adapter change is contained to Prisma.

```ts
export interface QueryFilter {
  field: string;                 // e.g. "status"
  value?: string | number | boolean;  // present for literal equality
  kind: "eq" | "in" | "other";   // v1 only reasons about "eq"
}

export interface QueryDescriptor {
  // …existing…
  filters?: QueryFilter[];       // NEW — extracted where-predicates
}
```

`hasFilter` is retained unchanged for back-compat and existing rules. Extraction
reads the `where` object literal: each top-level property becomes a `QueryFilter`.
A property with a literal initializer → `kind:"eq"` with `value`. An `{ in: [...] }`
initializer → `kind:"in"`. Anything else (nested objects, `AND`/`OR`, relations)
→ `kind:"other"`. The heuristic adapter does not populate `filters`.

---

## 5. Cardinality estimator & driving-set linker

Two new modules in `@queryguard/core`, each pure and independently tested.

### 5a. `estimateCardinality(descriptor, knowledge)`

```ts
type Bound = "small" | "medium" | "large" | "unknown";
interface Cardinality { count?: number; bound: Bound; source: "filter" | "table" | "none"; }
```

Logic:
1. No knowledge, or table not in knowledge → `{ bound:"unknown", source:"none" }`.
2. Descriptor has `eq` filters matching (superset of) a `filters[].when` entry →
   `count = entry.rows`, `source:"filter"`.
3. Else, no `where` at all (`hasFilter === false`) → `count = table.rows`,
   `source:"table"`.
4. Else (filtered, but no matching entry) → `{ bound:"unknown" }`.

`bound` is derived from `count` via thresholds: `<= small` → `small`,
`>= large` → `large`, otherwise `medium`.

### 5b. `resolveDrivingSet(loopNode, sourceFile, descriptors)` — conservative linker

Given a query descriptor that `isInsideLoop`, find the **cardinality of the
collection the loop iterates**. v1 succeeds only in the unambiguous case:

1. Identify the loop's iterated collection identifier — the `for (const x of EXPR)`
   right-hand side, or the receiver of `EXPR.map(...)` / `.forEach` / `.flatMap`.
   Require `EXPR` to be a plain identifier; anything else → `unknown`.
2. Resolve that identifier's declaration **within the same function scope**. Require
   exactly **one** declaration and **no reassignment** (via ts-morph
   `findReferences`; any write reference other than the initializer → `unknown`).
3. The declaration's initializer must be (optionally `await`-wrapped) a call that
   is itself a known descriptor in `descriptors`. Match by node identity.
4. Return `estimateCardinality(producerDescriptor, knowledge)`.

Any failed step → `{ bound:"unknown" }`. **The linker never guesses.** This is the
"conservative auto" path; the aggressive variants (chains, cross-function) are
explicitly out of scope and covered by inline hints (§7).

---

## 6. Rules react to cardinality

`RuleContext` is enriched so rules stay pure functions over precomputed data:

```ts
export interface RuleContext {
  descriptors: QueryDescriptor[];
  knowledge?: Knowledge;
  // precomputed once per analysis, keyed by descriptor:
  cardinalityOf: (d: QueryDescriptor) => Cardinality;    // §5a
  loopBoundOf: (d: QueryDescriptor) => Cardinality;      // §5b, only meaningful when d.inLoop
}
```

The engine computes `cardinalityOf` / `loopBoundOf` (including inline-hint
overrides, §7) once and passes them in. Rules:

- **`n-plus-one`** — for a descriptor with `d.inLoop`, consult `loopBoundOf(d)`:
  - `small` → **suppress** the diagnostic (or emit `info` — see decision below).
  - `large` → **escalate**: keep `error`, message quantifies it ("Query on `post`
    runs once per row of a ~10,000-row set (N+1 amplified ~10,000×). Batch it.").
  - `medium` / `unknown` → **today's behavior, unchanged** (including the existing
    `high`/`heuristic` confidence split).
- **`over-fetch`** (new rule, `defaultSeverity: "warning"`) — fires for a `read`
  descriptor when **all** hold: (a) `hasFilter === false`; (b) the table's own
  `rows` bucket is `large`; (c) the table has at least one `filters[]` entry whose
  `rows` bucket is `small`. It then emits "Read on `user` loads all ~10,000 rows,
  but a `status=active` (~10) subset likely suffices. Add a `where`, or confirm you
  need the full table." Never fires without knowledge; never fires on aggregates
  (`isAggregate`). Conditions (b)+(c) together guarantee a genuinely narrower
  subset exists, so the suggestion is never noise on an already-small table.
- **`unbounded-read`** — unchanged trigger; when a `count`/`table` cardinality is
  available it may append the number to sharpen the message. No behavior change
  when knowledge is absent.

**Decision — silence vs. downgrade.** v1 **suppresses** the `n-plus-one`
diagnostic entirely for a `small` bound (the user's "stop nagging me" case), rather
than emitting `info`. Rationale: an `info` on every provably-fine loop reintroduces
the noise the feature exists to remove. (A future `--explain` mode can surface the
suppression reasoning without cluttering default output.)

---

## 7. Inline hints (explicit fallback)

For the cases the conservative linker leaves `unknown`, the author overrides the
bound with a comment on, or on the line immediately above, the loop:

- `// queryguard: bounded` → force `small` (silence).
- `// queryguard: bounded 10` → force `small` and use `10` in any message.
- `// queryguard: unbounded` → force `large` (escalate).

Hints take precedence over inferred bounds. They are parsed from leading comments
attached to the loop statement (or the `.map`/`.forEach` call). Unrecognized
`queryguard:` directives are ignored silently. This is the sole way to influence a
verdict when data-flow cannot prove the bound — keeping the automatic path strict.

---

## 8. Engine wiring

```ts
// core
export function analyzeSource(code: string, filePath?: string, knowledge?: Knowledge | null): Diagnostic[];
export function loadKnowledge(path: string): Knowledge | null;
export function discoverKnowledge(fromPath: string): Knowledge | null;
```

`analyzeSource` builds descriptors as today, then computes the `cardinalityOf` /
`loopBoundOf` maps (applying inline-hint overrides), runs rules over the enriched
`RuleContext`, and finally **drops any diagnostic matched by a recorded suppression**
(§11) before returning. The `knowledge` argument defaults to `null`; with no
knowledge, no hints, and no suppressions, every bound is `unknown` and output is
**byte-identical to today**.

The **CLI** calls `discoverKnowledge(cwd)` once, then passes the result to every
`analyzeSource` call. A `--knowledge <path>` flag overrides discovery; `--no-knowledge`
disables it. A one-line notice ("using queryguard.knowledge.yaml") prints to stderr
so users know context is active.

---

## 9. Testing strategy

Per module, following the existing fixture style:
- **Adapter:** `filters[]` extraction — eq literal, `in`, nested/relation → `other`,
  no `where`.
- **`estimateCardinality`:** filter match (exact + superset), table fallback,
  unmatched filter → `unknown`, threshold bucketing at boundaries.
- **`resolveDrivingSet`:** the happy path (single-assignment, same function),
  and each failure mode (non-identifier RHS, reassignment, multi-declaration,
  initializer not a known query) → `unknown`.
- **Rules:** `n-plus-one` small→suppressed / large→escalated / unknown→unchanged;
  `over-fetch` fires only with knowledge + selective filter, never on aggregates.
- **Inline hints:** `bounded` / `bounded n` / `unbounded` override inference.
- **Suppression (§11):** anchor matching survives line shifts above the call;
  a changed call excerpt lapses the suppression; a matching suppression drops the
  diagnostic; suppress-command writes a well-formed entry and (on confirm) a fact;
  `--reason`/`--yes` run non-interactively.
- **Regression:** with **no** knowledge file, the full existing suite passes
  unchanged (the identity guarantee from §8).

---

## 10. Open decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Static vs. LLM | **Structured facts, 100% static.** |
| Behaviors in v1 | **All three:** silence, over-fetch suggest, escalate. |
| Loop→fact linking | **Conservative auto-trace + explicit inline-hint fallback.** Never silence on a guess. |
| `small` / `large` thresholds | Defaults **50 / 1000**, overridable in the knowledge file. |
| `over-fetch` placement | **New rule**, not folded into `unbounded-read`. |
| `small`-bound N+1 | **Suppress**, not downgrade to `info`. |
| Suppression surface | **Interactive `queryguard suppress` CLI command** (VS Code quick-fix deferred). |
| Suppression storage | **In the knowledge file**, anchored by rule + file + call excerpt (not raw line). |
| Learn-from-reason | **Log the site + suggest a fact on confirm** — never auto-promote. |

---

## 11. Suppression & the learn loop

Every diagnostic — `warning` or `error` — can be suppressed. Suppression is a
blunter tool than the §7 bound hints: it fully silences one specific diagnostic,
whereas hints only adjust a cardinality bound.

### 11a. Storage model

Suppressions live in the knowledge file (one source of truth) under `suppressions`:

```yaml
suppressions:
  - rule: n-plus-one
    file: src/contacts.ts
    fn: syncContacts          # enclosing function name (or "<module>")
    anchor: "prisma.contact.findMany(...)"   # normalized call excerpt
    reason: "contacts are bounded to active users (~10)"
    added: 2026-07-10
```

**Matching is line-independent.** A diagnostic is suppressed when its `rule`,
`file`, enclosing `fn`, and normalized call **anchor** all match an entry. Raw line
numbers are never used for matching, so inserting code above the call does **not**
un-silence it. If the call's own text changes materially, the anchor stops matching
and the suppression **lapses** — the diagnostic returns for re-evaluation, which is
the desired behavior (the code the user vouched for is no longer the code running).

### 11b. The `queryguard suppress` command

```
queryguard suppress <file>:<line> [--rule <id>] [--reason "<text>"] [--yes]
```

Interactive flow:
1. Analyze `<file>`; collect diagnostics whose range covers `<line>`. Zero → error
   ("no diagnostic there"). More than one → list them and require `--rule` (or
   prompt to pick).
2. Prompt `why are you suppressing this? (optional — Enter to skip)`.
3. Append a `suppressions[]` entry (rule, file, fn, anchor, reason, date) to the
   knowledge file, creating the file if absent.
4. **Suggest-a-fact:** if the resolved cardinality context implies a general fact
   (e.g. the driving table looks bounded), print the suggested `tables.*` entry and
   prompt `also record this as a fact? [y/N]`. Only on `y` is it merged into
   `tables`. This is the **only** path from a suppression to a general fact, and it
   is always an explicit confirm — auto-promotion was declined (precision-first).

Non-interactive: `--reason` supplies the text and `--yes` accepts the fact
suggestion without prompting, so the command is scriptable (and reusable by the
future VS Code quick-fix, which drives the same code path).

### 11c. Reversibility

A suppression is just a list entry — deleting it (or letting its anchor lapse)
restores the diagnostic. There is no hidden state. This keeps the mechanism honest:
silence is always visible, attributable (the `reason`), and revocable.
