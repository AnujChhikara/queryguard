# QueryGuard for VS Code

Flags inefficient database access — starting with N+1 query loops — in
TypeScript/JavaScript **as you type**. Powered by the `@queryguard/core` engine
(100% static: no LLM, no network, no database connection).

## What it flags today

- **N+1 / query inside a loop** — a Prisma-shaped query awaited inside a loop or
  `.map`/`.forEach`. Suggestion: batch into a single query (`include` / `WHERE ... IN`).

## Usage

Install the `.vsix`, then open a `.ts`/`.js`/`.tsx`/`.jsx` file. Problems appear
as red squiggles and in the Problems panel, updating ~300ms after you stop typing.

This is an early build: one rule, no configuration yet.
