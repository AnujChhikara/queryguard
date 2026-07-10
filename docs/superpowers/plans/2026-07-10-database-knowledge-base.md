# Database Knowledge Base (Dev-Time Reference) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a versioned, citable database knowledge base under `docs/database-knowledge/` that rule authors read before writing rules.

**Architecture:** Pure documentation. A `README.md` (index + how-to-use + sourcing policy), a fleshed `prisma.md` (N+1 complete, adjacent anti-patterns stubbed), and header-only engine stubs under `engines/`. No code changes. "Tests" are verification checks: template conformance, every claim cited, all markdown links resolve.

**Tech Stack:** Markdown only. Verification via `grep` and a link-check one-liner (`node`, already available in this pnpm repo).

**Spec:** `docs/superpowers/specs/2026-07-10-database-knowledge-base-design.md`

## Global Constraints

- Dev-time reference **only** — not shipped product content, not Lane 2 data, not a runtime artifact.
- Every factual claim MUST carry a citation (a `Sources` field). An uncited claim is a defect.
- Distill in our own words; never paste third-party text verbatim; do not vendor third-party skill files.
- Every entry follows the 7-field template: Anti-pattern, Code shape, Why it's bad, The fix, DB-specific limits/quirks, False-positive notes, Sources.
- First scope slice: Prisma + MySQL/PlanetScale(Vitess)/Postgres. Engine files are header-only stubs in this plan.
- Canonical sources: `planetscale/database-skills` (MIT) = engine truth; Prisma docs = ORM anti-patterns; `prisma/skills` `prisma-client-api` = query shapes.

---

### Task 1: Scaffold folder, README, and engine stubs

**Files:**
- Create: `docs/database-knowledge/README.md`
- Create: `docs/database-knowledge/engines/mysql.md`
- Create: `docs/database-knowledge/engines/vitess.md`
- Create: `docs/database-knowledge/engines/postgres.md`

**Interfaces:**
- Produces: the folder layout, the entry template (referenced by Task 2), and the sourcing/attribution policy.

- [ ] **Step 1: Write `docs/database-knowledge/README.md`**

```markdown
# QueryGuard Database Knowledge Base

**Dev-time reference only.** This is developer material we read *before writing a
rule* — not shipped product content, not Lane 2 rule data, not a runtime
artifact. See `docs/superpowers/specs/2026-07-10-database-knowledge-base-design.md`.

## How to use this while writing a rule

1. Open the entry for the ORM/DB you're targeting (e.g. `prisma.md`).
2. Find the anti-pattern. Its **Code shape** tells you what the adapter/rule must
   detect; **Why it's bad** feeds the diagnostic `message`/`docsUrl`; **The fix**
   feeds the suggestion; **False-positive notes** feed your negative fixtures.
3. Cite the entry in the rule's fixtures/comments.

## Entry template (every entry follows this)

Each anti-pattern has seven fields:

1. **Anti-pattern** — plain name.
2. **Code shape** — how it appears in source (ORM call / raw SQL).
3. **Why it's bad** — engine-level cost.
4. **The fix** — what the diagnostic should suggest.
5. **DB-specific limits/quirks** — hard, quotable facts (candidate Lane 2 constants later).
6. **False-positive notes** — shapes that look bad but aren't; link the FP corpus.
7. **Sources** — cited URLs + which harvested skill.

## Index

- [`prisma.md`](prisma.md) — Prisma ORM query shapes + anti-patterns.
- [`engines/mysql.md`](engines/mysql.md) — MySQL/InnoDB (stub).
- [`engines/vitess.md`](engines/vitess.md) — Vitess / PlanetScale sharding (stub).
- [`engines/postgres.md`](engines/postgres.md) — Postgres (stub).

## Sourcing & attribution policy

- **Engine truth:** `planetscale/database-skills` (MIT) —
  https://github.com/planetscale/database-skills
- **ORM anti-patterns:** Prisma docs —
  https://www.prisma.io/docs/orm/more/best-practices and
  https://www.prisma.io/docs/orm/prisma-client/queries/advanced/query-optimization-performance
- **Query shapes:** Prisma `prisma-client-api` skill —
  https://www.prisma.io/docs/ai/tools/skills

Rules of the base: distill in our own words, cite every claim, add an attribution
line for MIT-sourced material, never vendor third-party files.

> Portions of engine entries are distilled from planetscale/database-skills,
> used under the MIT License.

Each entry notes the date it was last checked against source.
```

- [ ] **Step 2: Write the three engine stubs**

`docs/database-knowledge/engines/mysql.md`:
```markdown
# MySQL / InnoDB — Engine Notes (STUB)

> Header stub. Flesh when a MySQL/InnoDB-specific rule lands.
> Source: planetscale/database-skills `mysql` skill (MIT).

Planned coverage: InnoDB secondary-index behavior, `IN (...)` list size cost,
covering indexes, when a JOIN beats N round trips.
```

`docs/database-knowledge/engines/vitess.md`:
```markdown
# Vitess / PlanetScale — Engine Notes (STUB)

> Header stub. Flesh when a sharding/fan-out rule lands.
> Source: planetscale/database-skills `vitess` skill (MIT).

Planned coverage: scatter-gather queries across shards, cross-shard fan-out cost,
why unbounded `IN` / loop queries are worse on a sharded topology than on a
single MySQL node.
```

`docs/database-knowledge/engines/postgres.md`:
```markdown
# Postgres — Engine Notes (STUB)

> Header stub. Flesh when a Postgres-specific rule lands.
> Source: planetscale/database-skills `postgres` skill (MIT).

Planned coverage: planner behavior for `IN` vs JOIN, index usage, over-fetch cost.
```

- [ ] **Step 3: Verify structure and links**

Run:
```bash
ls docs/database-knowledge docs/database-knowledge/engines && \
node -e "const fs=require('fs');const p='docs/database-knowledge/README.md';const t=fs.readFileSync(p,'utf8');for(const m of t.matchAll(/\]\(([^)h][^)]*)\)/g)){const rel='docs/database-knowledge/'+m[1];if(!fs.existsSync(rel)){console.error('BROKEN LINK:',m[1]);process.exit(1)}}console.log('links OK')"
```
Expected: lists `README.md` + `prisma.md`(missing until Task 2 — acceptable this run) and the three engine files; the link checker will report `prisma.md` broken. That is expected now; re-run after Task 2 for green.

- [ ] **Step 4: Commit**

```bash
git add docs/database-knowledge
git commit -m "docs(kb): scaffold database knowledge base README + engine stubs"
```

---

### Task 2: Write `prisma.md` — N+1 fleshed + adjacent anti-patterns stubbed

**Files:**
- Create: `docs/database-knowledge/prisma.md`

**Interfaces:**
- Consumes: the 7-field template and sourcing policy from Task 1's README.
- Produces: the first fleshed entry; complete enough that the shipped `n-plus-one`
  rule's fixtures could be regenerated from the **Code shape** / **False-positive notes**.

- [ ] **Step 1: Write `prisma.md` with the fleshed N+1 entry**

```markdown
# Prisma — Query Anti-Patterns

_Last checked against source: 2026-07-10._

Follows the 7-field template in [`README.md`](README.md).

---

## N+1 / query inside a loop

1. **Anti-pattern:** One query fetches N rows, then one additional query runs per
   row to load related data — 1 + N round trips.

2. **Code shape:**
   ```ts
   const users = await prisma.user.findMany()
   for (const user of users) {
     const posts = await prisma.post.findMany({ where: { authorId: user.id } })
   }
   ```
   Also appears via `.map`/`.forEach`/`.flatMap` callbacks that `await` a query,
   and inside `Promise.all([...].map(...))`. Wrapping in `Promise.all` parallelizes
   but does **not** reduce the query count — 100 users is still 101 queries.

3. **Why it's bad:** Round-trip count scales linearly with result-set size; each
   round trip pays network + planning latency. On a sharded topology (Vitess/
   PlanetScale) the per-iteration query can scatter across shards, multiplying the
   cost — see [`engines/vitess.md`](engines/vitess.md).

4. **The fix:**
   - Eager-load in one nested read: `prisma.user.findMany({ include: { posts: true } })` (two SQL queries: parent + related).
   - Force a single joined query: add `relationLoadStrategy: "join"` (one SQL query).
   - Batch manually with an `in` filter:
     ```ts
     const users = await prisma.user.findMany()
     const posts = await prisma.post.findMany({
       where: { authorId: { in: users.map(u => u.id) } },
     })
     ```

5. **DB-specific limits/quirks:** Very large `in` lists shift cost to the engine
   (list-size limits, planner behavior) — quantify per engine in `engines/*` when
   a Lane 2 rule needs it. Not wired to Lane 2 in this project.

6. **False-positive notes:** Not every `.forEach`/`.map` is an array loop —
   `Map.prototype.forEach`, stream `.forEach`, and RxJS operators match a
   name-only loop check but are not N+1. This is the seed entry for the
   false-positive corpus deferred from Plan 1. A single awaited query with no
   enclosing loop is not N+1.

7. **Sources:**
   - Prisma query optimization (n+1, `include`, `relationLoadStrategy: "join"`, `in` batching): https://www.prisma.io/docs/orm/prisma-client/queries/advanced/query-optimization-performance
   - Prisma best practices: https://www.prisma.io/docs/orm/more/best-practices
   - Query shapes (`findMany`/`include`/`select`/`in`): Prisma `prisma-client-api` skill — https://www.prisma.io/docs/ai/tools/skills

---

## Adjacent anti-patterns (STUBS — flesh when the rule lands)

- **Unbounded fan-out** — a query inside a loop whose iteration count is
  unbounded (or a very large `in` list). Distinct from N+1: even one query per
  item is dangerous when the item count is unbounded. TODO: flesh with the
  unbounded-fan-out rule; needs `QueryDescriptor.filterArgs` + loop-bound
  analysis.
- **Over-fetch** — `findMany`/`findUnique` with no `select`, pulling whole rows
  when only an id/one column is used. TODO: flesh when the over-fetch rule lands;
  Prisma docs list over-fetching as a slow-query cause but give no `select`
  guidance, so cite an engine source for the cost.
- **Missing limit** — an unbounded `findMany` with no `take`/pagination on a
  growing table. TODO: flesh when the missing-limit rule lands.
```

- [ ] **Step 2: Verify template conformance and citations**

Run:
```bash
node -e "const fs=require('fs');const t=fs.readFileSync('docs/database-knowledge/prisma.md','utf8');const need=['Anti-pattern','Code shape','Why it','The fix','DB-specific','False-positive notes','Sources'];const miss=need.filter(n=>!t.includes(n));if(miss.length){console.error('MISSING FIELDS:',miss);process.exit(1)}if(!/Sources:[\s\S]*https?:\/\//.test(t)){console.error('N+1 entry has no cited URL');process.exit(1)}console.log('prisma.md template + citations OK')"
```
Expected: `prisma.md template + citations OK`

- [ ] **Step 3: Re-run the README link checker (now green)**

Run:
```bash
node -e "const fs=require('fs');const t=fs.readFileSync('docs/database-knowledge/README.md','utf8');for(const m of t.matchAll(/\]\(([^)h][^)]*)\)/g)){const rel='docs/database-knowledge/'+m[1];if(!fs.existsSync(rel)){console.error('BROKEN LINK:',m[1]);process.exit(1)}}console.log('links OK')"
```
Expected: `links OK`

- [ ] **Step 4: Commit**

```bash
git add docs/database-knowledge/prisma.md
git commit -m "docs(kb): add Prisma N+1 entry + adjacent anti-pattern stubs"
```

---

## Self-Review

**Spec coverage:**
- §3 structure (folder + README + prisma.md + engine stubs) → Task 1 + Task 2. ✓
- §4 seven-field template → README (Task 1) + applied in prisma.md (Task 2). ✓
- §4 adjacent anti-patterns stubbed → Task 2 Step 1. ✓
- §5 sourcing/attribution policy → README (Task 1). ✓
- §6 workflow + FP corpus link → README how-to-use + prisma.md FP notes. ✓
- §7 success criteria (one cited source per anti-pattern; N+1 regenerable) → Task 2 verification. ✓
- §2 out-of-scope (engines header-only, no code changes) → respected; engine files are stubs. ✓

**Placeholder scan:** The only `TODO`s are intentional stub markers for adjacent
anti-patterns (per spec §4), each naming the rule and prerequisite that unblocks
it — not plan placeholders.

**Type consistency:** N/A (docs). File paths and link targets are consistent
between README index and actual files.
