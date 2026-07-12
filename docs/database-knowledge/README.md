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

- [`adapters.md`](adapters.md) — per-adapter detection coverage (Prisma, Drizzle, Mongoose, raw SQL, heuristic).
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
