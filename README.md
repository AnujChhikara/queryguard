# QueryGuard

**A database-aware static analyzer for TypeScript/JavaScript.** It flags
inefficient database access — N+1 loops, over-fetching, unbounded fan-out — like
ESLint, but specialized for the data layer. 100% static: no LLM, no network, no
database connection; your code never leaves your machine.

> **Status:** early. Today QueryGuard ships a core engine and a CLI with one
> rule (`n-plus-one`) and one adapter (Prisma). The VS Code extension and
> additional rules/adapters are planned — see [Roadmap](#roadmap).

## What's here

This is a pnpm monorepo:

| Package | What it does |
|---------|--------------|
| `@queryguard/core` | Parses TS with ts-morph, normalizes query calls into `QueryDescriptor`s, runs rules, emits diagnostics. Front-end-agnostic. |
| `@queryguard/cli` | Globs files, runs the engine, prints diagnostics, sets the exit code (for CI gates). |

## Requirements

- Node.js >= 18
- pnpm

## Build & test

```bash
pnpm install
pnpm build        # builds all packages
pnpm test         # builds, then runs the full suite (18 tests)
```

## Using the CLI

The CLI takes one or more **globs relative to your current directory** and prints
one line per problem, exiting `1` if any error-severity diagnostic is found (so it
works as a CI gate).

```bash
# from the repo root, after `pnpm build`
node packages/cli/dist/bin.js "src/**/*.ts"
```

> **Note:** paths are resolved relative to the current working directory. An
> absolute path or a path outside the current directory won't match — `cd` into
> your project first and use a relative glob.

### Try it

Create a file with an N+1 pattern:

```ts
// bad.ts
const users = await prisma.user.findMany()
for (const user of users) {
  const posts = await prisma.post.findMany({ where: { authorId: user.id } })
}
```

Run:

```bash
node packages/cli/dist/bin.js "bad.ts"
```

Output:

```
bad.ts:3:23  error  n-plus-one  Query on "post" runs inside a loop (N+1). Batch it into a single query (e.g. a WHERE ... IN / findMany).

1 problem(s), 1 error(s)
```

The fix (single query, no loop) reports zero problems and exits `0`:

```ts
// good.ts
const users = await prisma.user.findMany({ include: { posts: true } })
```

## How it works

QueryGuard is designed around a **three-lane pipeline**, split by *when* a check
runs:

- **Lane 1 — Syntactic** (every keystroke): high-confidence structural errors. `n-plus-one` lives here.
- **Lane 2 — Constant** (every keystroke): deterministic DB/ORM facts (e.g. list-size limits).
- **Lane 3 — Data-flow** (debounced/on-save): confidence-tagged warnings.

Guiding principle: **precision over recall** — a linter that cries wolf gets
disabled the same day. High-confidence checks are errors; inferred checks are
warnings.

Design details: [`docs/superpowers/specs/2026-07-10-queryguard-design.md`](docs/superpowers/specs/2026-07-10-queryguard-design.md).
Rule-authoring reference: [`docs/database-knowledge/`](docs/database-knowledge/).

## Roadmap

- VS Code extension (`@queryguard/vscode`) — live squiggles + hovers, sharing this engine.
- More Lane 1/2/3 rules: unbounded fan-out, over-fetch, missing limit.
- More adapters beyond Prisma (Drizzle, raw SQL) and more engines (MySQL/PlanetScale/Postgres).
- Config (`queryguard.config.ts`): enable/disable rules, severity overrides.

## License

MIT
