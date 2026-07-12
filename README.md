# Cardinal

**A database-aware static analyzer for TypeScript/JavaScript.** It flags
inefficient database access — N+1 loops, over-fetching, unbounded fan-out — like
ESLint, but specialized for the data layer. 100% static: no LLM, no network, no
database connection; your code never leaves your machine.

> **Status:** early. Today Cardinal ships a core engine, a CLI, and a VS Code
> extension with three rules (`n-plus-one`, `unbounded-read`, `over-fetch`),
> adapters for **Prisma, Drizzle, Mongoose, and raw SQL** (plus a heuristic
> fallback), and an optional **knowledge file** that makes the rules
> scale-aware. See [Roadmap](#roadmap) for what's next.

## What's here

This is a pnpm monorepo:

| Package | What it does |
|---------|--------------|
| `@cardinal/core` | Parses TS with ts-morph, normalizes query calls into `QueryDescriptor`s, runs rules, emits diagnostics. Front-end-agnostic. |
| `@cardinal/cli` | Globs files, runs the engine, prints diagnostics, sets the exit code (for CI gates). |

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

## Business-logic context

Structural rules see *shape*, not *scale* — a query in a loop looks like an N+1
whether the loop runs twice or two million times. Drop a
**`cardinal.knowledge.yaml`** next to your code to give Cardinal the missing
scale information. It's a static, human-authored file — it stays on your machine
and is never transmitted.

```yaml
version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
```

With this file Cardinal **silences** loops over provably-small sets,
**escalates** loops over provably-large sets, and warns (`over-fetch`) when an
unfiltered read on a large table has a selective alternative. Cardinal
discovers the file by walking up from the current directory; override with
`--knowledge <path>` or disable with `--no-knowledge`.

Where a set isn't statically traceable, annotate the loop:

```ts
// cardinal: bounded 10
for (const id of getIds()) { await prisma.post.findMany({ where: { authorId: id } }); }
```

### Suppressing a diagnostic

To silence a specific finding, record a suppression instead of editing code:

```bash
node packages/cli/dist/bin.js suppress "src/contacts.ts:42" --reason "list is admin-curated, < 20"
```

This appends an entry to the knowledge file matched by rule + enclosing function +
the normalized call text (never the line number, so it survives edits above the
call). Run it without `--reason` for an interactive prompt. In the VS Code
extension the same flow is a lightbulb quick-fix on any Cardinal squiggle. Full details:
[`docs/database-knowledge/business-logic-context.md`](docs/database-knowledge/business-logic-context.md).

## Configuration

Drop a **`cardinal.config.json`** (or `.yaml`) in your project to turn rules off
or change their severity. It's discovered by walking up from the current
directory, same as the knowledge file.

```json
{
  "rules": {
    "over-fetch": "off",
    "unbounded-read": "warning",
    "n-plus-one": "error"
  }
}
```

Each rule maps to `"error"`, `"warning"`, `"info"`, or `"off"`. Rules you don't
list keep their default behavior. Disable discovery entirely with `--no-config`.
The VS Code extension reads the same file and re-lints when it changes.

## How it works

Cardinal is designed around a **three-lane pipeline**, split by *when* a check
runs:

- **Lane 1 — Syntactic** (every keystroke): high-confidence structural errors. `n-plus-one` lives here.
- **Lane 2 — Constant** (every keystroke): deterministic DB/ORM facts (e.g. list-size limits).
- **Lane 3 — Data-flow** (debounced/on-save): confidence-tagged warnings.

Guiding principle: **precision over recall** — a linter that cries wolf gets
disabled the same day. High-confidence checks are errors; inferred checks are
warnings.

Design details: [`docs/superpowers/specs/2026-07-10-queryguard-design.md`](docs/superpowers/specs/2026-07-10-queryguard-design.md) (original design docs predate the rename).
Rule-authoring reference: [`docs/database-knowledge/`](docs/database-knowledge/).

## Roadmap

- VS Code extension (`@cardinal/vscode`) — live squiggles + hovers, sharing this engine.
- More Lane 1/2/3 rules: missing limit, and Lane 2 engine-specific limits.
- Deepen the newer adapters: predicate-value extraction (unlocks `over-fetch`/cardinality beyond Prisma), Drizzle's chained query builder, and a real SQL parser.
- More engines (MySQL/PlanetScale/Postgres) and more data layers (TypeORM, Kysely).
- Config (`cardinal.config.ts`): enable/disable rules, severity overrides.

## License

MIT
