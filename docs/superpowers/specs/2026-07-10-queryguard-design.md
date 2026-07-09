# QueryGuard — Design Spec

**Date:** 2026-07-10
**Status:** Approved design, pending implementation plan
**Working name:** QueryGuard (rename anytime)

---

## 1. Problem & Purpose

Developers routinely ship unoptimized database access — N+1 loops, over-fetching
(pulling whole rows/documents when only an id is used), queries against
un-indexed fields, and unbounded fan-out that exhausts connection pools. These
mistakes usually escape review: reviewers miss them, and they only surface as
production latency or outages. Existing tools catch them **late** (APM/observability
after deploy) or **generically** (SonarQube-style, not database-aware).

QueryGuard is a **database-aware static analyzer** that runs **as you type** in the
editor and again in CI, flagging bad database access inline — like ESLint/SonarQube,
but specialized for the database layer, across multiple databases and ORMs.

**Success (product intent):** a real product developers install and, eventually,
pay for. v1 must be trustworthy and instant enough that people leave it on.

### Guiding principle
> A DB linter that cries wolf gets disabled the same day.
> **Precision (few false positives) beats recall.** High-confidence checks are
> errors; inferred/deep checks are confidence-tagged warnings.

---

## 2. Scope

### In scope (v1)
- **Language:** TypeScript / JavaScript only.
- **Analysis:** 100% static (AST + type info). **No LLM, no network, no DB connection.**
  Code never leaves the machine.
- **Surfaces:** VS Code extension (live) **and** CLI/CI (PR gate), sharing one engine.
- **Check tiers 1 & 2** everywhere, plus **tier-3 data-flow** (intra-module) as
  confidence-tagged warnings.

### Out of scope (v1) — deferred
- **LLM-assisted analysis / autofix** → v2 paid tier.
- **Project-specific schema/runtime facts** (does *this* column have an index, what
  is *this* pool size) → later; requires a schema/config source.
- **Whole-program / cross-module data-flow** → v2 "deep mode."
- **Non-JS/TS languages** → later rule-pack work on the same core.

### Non-negotiable constraints
- Lanes 1 & 2 must stay under a per-file latency budget (~50ms on a large file) so
  typing never lags.
- Analysis is best-effort: a failing rule or unparsable (mid-typing) file must never
  break the editor.

---

## 3. Architecture

One reusable **core engine** wrapped by two thin front-ends. A/B/C detection
strategies coexist via a **three-lane pipeline** split by *when it runs* and
*how confident it is*.

```
                    ┌───────────────────────────────────────────┐
   source code ──►  │            CORE ENGINE (TS/JS)             │
                    │  parse → TS AST + type info (ts-morph)     │
                    │                                            │
                    │  Lane 1  SYNTACTIC  (A)  every keystroke   │──► ERRORS   (high confidence)
                    │          local AST patterns, <50ms         │
                    │                                            │
                    │  Lane 2  CONSTANT   (C)  every keystroke   │──► ERRORS   (deterministic facts)
                    │          DB/ORM rule packs, table lookup   │      e.g. Firestore in≤30
                    │                                            │
                    │  Lane 3  DATA-FLOW  (B)  on save/debounced │──► WARNINGS (confidence-tagged)
                    │          intra-module call graph, worker    │      cross-function N+1
                    └───────────────────────────────────────────┘
                          ▲                              ▲
                 ┌────────┴────────┐            ┌────────┴─────────┐
                 │  VS Code ext    │            │  CLI / ESLint    │
                 │  (LSP client)   │            │  (CI PR gate)    │
                 └─────────────────┘            └──────────────────┘
```

**Why three lanes:** it lets v1 "go deep" (data-flow is included) without the deep
analysis wrecking latency or precision. Lanes 1 & 2 are synchronous, deterministic,
and emit errors. Lane 3 runs off the typing hot path (debounced / on save, in a
background worker) and emits only confidence-tagged warnings, so inference noise can
never masquerade as a hard error.

### Components
- **`@queryguard/core`** — parsing, adapters, `QueryDescriptor` extraction, the rule
  runner, the three-lane scheduler, diagnostics model. Front-end-agnostic.
- **`@queryguard/lsp`** — language server exposing the core over LSP.
- **`@queryguard/vscode`** — thin LSP client: squiggles, hovers (rule explanation +
  docs link), quick-fixes.
- **`@queryguard/cli`** — runs core over a glob; non-zero exit on errors; for CI /
  pre-commit.
- **`@queryguard/eslint-plugin`** (optional) — wraps the same rules for teams already
  on ESLint.
- **Rule packs** — see §4.

---

## 4. Rule-pack model

Breadth (many DBs/ORMs, many constant rules) scales as **data/plugins**, not engine
edits.

### Adapters (per DB driver / ORM)
`prisma`, `drizzle`, `mongoose`, and raw `pg`, `mongodb`, `firebase-admin`.
An adapter's only job: recognize "this AST node is a query for DB X" and normalize it
into a **`QueryDescriptor`**:

```
QueryDescriptor {
  db: 'postgres' | 'mysql' | 'mongodb' | 'firebase'
  orm: 'prisma' | 'drizzle' | 'mongoose' | 'raw'
  operation: 'read' | 'write' | 'delete' | ...
  target: string           // table / collection
  selectedFields?: string[] // undefined = all fields
  filterArgs: FilterArg[]   // incl. array literals/vars for in / $in
  node: ASTNode             // for range + data-flow
  inLoop: boolean
  awaited: boolean
}
```

### Rule
```
Rule {
  id: string                       // e.g. "n-plus-one", "firestore/in-limit"
  lane: 'syntactic' | 'constant' | 'dataflow'
  defaultSeverity: 'error' | 'warning' | 'info'
  appliesTo: Array<db|orm|'*'>
  match(ctx): Diagnostic[]         // consumes AST node and/or QueryDescriptor
  message: string
  docsUrl: string
  fix?: (ctx) => TextEdit[]        // optional autofix
}
```

Tier-1 rules consume `QueryDescriptor`s and stay DB-agnostic. Tier-2 rules bind to a
specific pack.

### Config
`queryguard.config.ts` / `.queryguardrc`: enable/disable rules, severity overrides,
per-path ignores, inline `// queryguard-disable-next-line`. Standard lint ergonomics.

---

## 5. v1 rule set (MVP boundary)

**Tier 1 — DB-agnostic (Lanes 1):**
- `n-plus-one` — query node inside a loop (`for`/`for..of`/`while`/`.map`/`.forEach`/
  `Promise.all([...map(query)])`).
- `over-fetch` — select-all (`SELECT *` / `findMany` with no select) whose result only
  ever reads a narrow subset (e.g. only `.id`) in the same scope.
- `unbounded-fan-out` — `Promise.all` over an unbounded array of queries → pool-exhaustion risk.
- `missing-await` — query call result not awaited/returned (fire-and-forget).

**Tier 2 — DB/ORM constant (Lane 2):**
- Firestore: `in`/`not-in` ≤ 30 ids; batch write ≤ 500; `!=` / inequality constraints.
- MongoDB: large `$in`; unindexed-by-construction operators (best-effort, static).
- Postgres: bind-parameter cap (65535); oversized `IN (...)` lists.
- MySQL: equivalent parameter / `IN`-list limits.

**Tier 3 — data-flow warnings (Lane 3, intra-module):**
- `n-plus-one` where the query hides in a helper function called inside a loop within
  the same module. Confidence-tagged warning, never error.

### Coverage phasing *within* v1
Ship the engine + two flagship packs first — **Postgres/Prisma** and
**Firestore/firebase-admin** — then fast-follow MySQL, MongoDB, Drizzle, Mongoose on
the same core. (This is the one place we phase rather than block v1 on full coverage.)

---

## 6. Data flow (per analyzed file)

```
file text
  → parse to TS AST (+ type info via ts-morph / TS language service)
  → detect active DB/ORM (imports + package.json + config)
  → adapter builds QueryDescriptor[] for query nodes
  → Lane 1 (syntactic rules)  ┐ synchronous, on keystroke
  → Lane 2 (constant rules)   ┘
  → Lane 3 (data-flow rules)  → debounced, background worker
  → merge → Diagnostic[] { range, severity, ruleId, message, docsUrl, fix?, confidence? }
  → surfaced by VS Code (squiggles/hover/quick-fix) or CLI (stdout + exit code)
```

---

## 7. Error handling & resilience
- Each rule runs sandboxed; a thrown error is caught, logged, and skipped — one bad
  rule never breaks a file's analysis or the editor.
- Unparsable / incomplete files (mid-typing) are skipped gracefully; last good
  diagnostics may be retained until the next clean parse.
- Adapter that can't confidently identify a node emits nothing (precision-first).

---

## 8. Testing strategy
- **Rule fixture tests:** code snippet in → expected diagnostics out (the standard
  lint-rule harness). Every rule ships with positive and negative fixtures.
- **Pack golden tests:** representative real-world snippets per DB/ORM.
- **Adapter tests:** AST node → expected `QueryDescriptor`.
- **Perf budget test:** Lanes 1+2 under the latency budget on a large file.
- **False-positive corpus:** a growing set of "must NOT flag" snippets guarding
  precision as rules evolve.

---

## 9. Key risks & mitigations
| Risk | Mitigation |
|------|-----------|
| False positives erode trust | Precision-first; confidence tags; easy inline/config disables; false-positive corpus |
| Deep (Lane 3) analysis adds latency | Runs debounced in a background worker, off the keystroke path |
| Breadth burden (many DBs/ORMs) | Rule-pack/adapter plug-in model; constant rules are data |
| Adapter drift as ORMs change | Versioned adapters + fixture tests pinned per ORM major |
| Scope creep into schema-aware checks | Explicitly deferred to a later milestone with a schema source |

---

## 10. Roadmap beyond v1
- **v2 (paid):** LLM-assisted "deep analysis / explain / autofix"; whole-program
  cross-module data-flow ("deep mode"); optional schema-aware checks (real index
  detection, pool-size-aware fan-out) via a connected schema/config source.
- **Later:** additional language rule packs on the same core; community rule packs.

---

## 11. Open questions (for spec review)
- Final product name (QueryGuard is a placeholder).
- Monorepo tooling choice (pnpm workspaces + Turborepo vs Nx) — implementation detail,
  decide in the plan.
- Exact latency budget number (placeholder ~50ms) — confirm against a real large-file
  benchmark during implementation.
