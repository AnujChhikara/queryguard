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
