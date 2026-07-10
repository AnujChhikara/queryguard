# QueryGuard — Database Knowledge Base (Dev-Time Reference) — Design Spec

**Date:** 2026-07-10
**Status:** Approved design, pending implementation plan
**Relates to:** [QueryGuard Design Spec](2026-07-10-queryguard-design.md) (§4 rule packs, §5 rule set, §8 testing)

---

## 1. Problem & Purpose

QueryGuard's rules are only as good as our knowledge of what actually hurts a
given database. Today that knowledge lives in our heads and in scattered blog
posts. When we write or refine a rule, we re-derive the same facts (what shape to
detect, why it's slow, what to suggest, what *not* to flag), and we do it
imprecisely — which is fatal for a linter whose guiding principle is *precision
beats recall*.

This project builds a **dev-time database knowledge base**: a versioned,
citable reference in the repo that a rule author reads before writing a rule. It
is **not shipped product content** — it is developer reference that makes our
rules more accurate, realistic, and traceable.

**Explicitly a dev-time aid.** It does not become Lane 2 constant-rule data, an
installed skill, or any runtime artifact. Hard facts captured here (e.g. Vitess
`IN` fan-out limits) may *later* inform Lane 2 rules, but wiring that is out of
scope for this project.

---

## 2. Scope

### In scope
- A knowledge base under `docs/database-knowledge/` structured to serve
  rule-writing directly.
- **First scope slice:** Prisma ORM plus the engines behind it —
  MySQL / PlanetScale (Vitess) / Postgres.
- **First deliverable:** `README.md` (index + how-to-use + sourcing policy) and
  `prisma.md` (fully fleshed for the shipped N+1 rule, with adjacent
  anti-patterns stubbed).
- A single **entry template** every future entry follows.
- A **sourcing & attribution policy** for harvesting from MIT-licensed skills and
  public docs.

### Out of scope
- Engine files (`engines/mysql.md`, `vitess.md`, `postgres.md`) are **stubbed
  with headers only** in the first deliverable; fleshing them is follow-up work
  added incrementally.
- Any code change to `@queryguard/core` or `@queryguard/cli`.
- Wiring knowledge into Lane 2 rules or the false-positive corpus tooling (we
  link to it; we don't build it here).
- Vendoring third-party skill files into the repo. We distill, we don't copy.

### Guiding principle
> Every claim in this knowledge base is **cited** and **distilled in our own
> words**. An uncited fact is a bug. The base grows one authoritative entry at a
> time — start with one, keep adding what proves useful.

---

## 3. Structure

```
docs/database-knowledge/
  README.md            # index, how-to-use-while-writing-rules, sourcing/attribution policy
  prisma.md            # ORM query shapes + anti-patterns (first fleshed entry)
  engines/
    mysql.md           # header stub only (InnoDB indexing, IN limits) — filled later
    vitess.md          # header stub only (scatter-gather, shard fan-out) — filled later
    postgres.md        # header stub only (planner, index notes) — filled later
```

Folder from the start so growth never requires restructuring. `engines/`
separates ORM-level anti-patterns (how bad access *looks in code*) from
engine-level truth (why it's *actually* expensive on that database).

---

## 4. Entry Template

Every entry (ORM or engine) is organized as a list of anti-patterns, each with
these seven fields. The fields exist so the entry maps 1:1 onto what a rule
author needs:

1. **Anti-pattern** — plain name (e.g. "query inside a loop / N+1").
2. **Code shape** — how it appears in source (Prisma call, raw SQL). → feeds the
   adapter's `QueryDescriptor` extraction and the rule's detection.
3. **Why it's bad** — engine-level cost (round trips; Vitess scatter across
   shards; unindexed scan). → feeds the diagnostic `message` and `docsUrl`.
4. **The fix** — what the diagnostic should suggest (`include`, `in` batch,
   `relationLoadStrategy: "join"`, add index). → feeds the fix hint.
5. **DB-specific limits/quirks** — hard, quotable facts (e.g. an `IN` size limit).
   → candidate Lane 2 constants later; out of scope to wire now.
6. **False-positive notes** — shapes that look bad but aren't; links to the
   spec's FP corpus (design spec §8). → keeps precision high.
7. **Sources** — cited URLs and which harvested skill, for traceability and
   later updates.

Adjacent anti-patterns to **stub** in `prisma.md` (name + one line + "TODO:
flesh when rule lands"), so the doc already guides the *next* rules:
- Unbounded fan-out (query in loop with no bound / large `in`)
- Over-fetch (no `select` / `select` unused fields)
- Missing limit (unbounded `findMany`)

---

## 5. Sourcing & Attribution Policy (lives in README.md)

- **Primary sources** and their role:
  - `planetscale/database-skills` (MIT) — **engine truth**: MySQL/InnoDB
    indexing, Vitess scatter-gather and shard fan-out, Postgres.
  - Prisma docs (best-practices, query-optimization) — **ORM anti-patterns**:
    N+1, batching, `relationLoadStrategy`.
  - `prisma/skills` `prisma-client-api` — **query-shape reference**: exact
    `findMany` / `include` / `select` / `in` shapes our adapter keys off.
- **Rules of the base:**
  - Distill into our own words; never paste third-party text verbatim.
  - Cite every claim (field 7). An uncited claim is treated as a defect.
  - MIT-sourced material gets an attribution line in `README.md`.
  - We do not vendor third-party skill files into the repo.

---

## 6. How It Plugs Into the Workflow

- **Before** writing or refining a rule, the author reads the matching entry and
  cites it in the rule's fixtures/comments.
- Each anti-pattern's **Code shape** + **False-positive notes** directly seed the
  rule's positive and negative fixtures (design spec §8).
- FP notes feed the **false-positive corpus** already deferred from Plan 1
  (e.g. `Map`/stream `.forEach` matching `isInsideLoop`).
- The base is **append-only in spirit**: start with Prisma, add an engine entry
  whenever we mine a PlanetScale skill or hit a real gap.

---

## 7. Success Criteria

- A rule author can open one file and get: what to detect, why, what to suggest,
  and what not to flag — without re-searching the web.
- Every anti-pattern in `prisma.md` has at least one cited source.
- The N+1 entry is complete enough that our shipped `n-plus-one` rule's fixtures
  could be regenerated from it.
- Adding a new DB/ORM later means adding a file that follows the template — no
  restructuring.

---

## 8. Non-Goals / Risks

- **Risk: knowledge rot.** Cited sources let us re-verify; entries note the date
  they were last checked against source.
- **Risk: scope creep into product data.** Mitigated by §1 (dev-time only) and
  the out-of-scope list.
- **Risk: over-documenting ahead of rules.** Mitigated by stubbing (not
  fleshing) adjacent anti-patterns and engine files until a rule needs them.
