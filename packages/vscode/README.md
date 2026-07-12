# Cardinal for VS Code

Flags inefficient database access — N+1 loops, unbounded reads, over-fetching —
in TypeScript/JavaScript **as you type**. Powered by the `@cardinal/core` engine
(100% static: no LLM, no network, no database connection).

## What it flags

- **n-plus-one** — a query awaited inside a loop or `.map`/`.forEach`/`.flatMap`.
- **unbounded-read** — a read with no filter and no limit (may scan the table).
- **over-fetch** — an unfiltered read on a large table with a selective alternative.
- **order-by-rand** — `ORDER BY RAND()`/`RANDOM()` (full sort, no index).
- **leading-wildcard-like** — `LIKE '%…'` (non-sargable, full scan).
- **excessive-joins** — a query joining many tables (counted by a real SQL parser).

Adapters: **Prisma, Drizzle, Mongoose, and raw SQL** (plus a heuristic fallback).

## Business-logic context

Drop a `cardinal.knowledge.yaml` in your project (table sizes + filter
selectivity) and Cardinal becomes scale-aware — silencing provably-small loops,
escalating provably-large fan-out, and enabling `over-fetch`. The file is
discovered automatically and re-read live on change. Toggle via the
**Cardinal › Use Knowledge** setting.

## Suppress a finding

On any Cardinal squiggle, open the lightbulb (`⌘.` / `Ctrl+.`) and choose
**Suppress "<rule>" (Cardinal)**. You'll be asked for an optional reason, and —
when a cardinality fact is implied — offered the chance to record it. The
suppression is written to `cardinal.knowledge.yaml`, matched by rule + function +
normalized call text (not line number, so it survives edits above the call).

## Usage

Install the `.vsix`, then open a `.ts`/`.js`/`.tsx`/`.jsx` file. Problems appear
as squiggles and in the Problems panel, updating ~300ms after you stop typing.
