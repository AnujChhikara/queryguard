# Cardinal

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/anujchhikara.cardinal-vscode?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=anujchhikara.cardinal-vscode)
[![npm](https://img.shields.io/npm/v/cardinal-cli?label=cardinal-cli)](https://www.npmjs.com/package/cardinal-cli)
[![Open VSX](https://img.shields.io/open-vsx/v/anujchhikara/cardinal-vscode?label=Open%20VSX)](https://open-vsx.org/extension/anujchhikara/cardinal-vscode)
[![CI](https://github.com/AnujChhikara/cardinal/actions/workflows/ci.yml/badge.svg)](https://github.com/AnujChhikara/cardinal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A database-aware static analyzer for TypeScript/JavaScript.** It flags
inefficient database access — N+1 loops, over-fetching, unbounded fan-out — like
ESLint, but specialized for the data layer. 100% static: no LLM, no network, no
database connection; your code never leaves your machine.

> **Status:** early. Today Cardinal ships a core engine, a CLI, and a VS Code
> extension with seven rules (`n-plus-one`, `unbounded-read`, `over-fetch`,
> `order-by-rand`, `leading-wildcard-like`, `excessive-joins`,
> `unindexed-query`), adapters for **Prisma, Drizzle, Mongoose, TypeORM, and
> raw SQL** (the last parsed with a real SQL parser), **schema-awareness**
> (indexes read straight from your `schema.prisma`), an optional **knowledge
> file** that makes the rules scale-aware, and a **config file** to tune them.
> See [Roadmap](#roadmap) for what's next.

## What's here

This is a pnpm monorepo:

| Package | What it does |
|---------|--------------|
| `cardinal-core` | Parses TS with ts-morph, normalizes query calls into `QueryDescriptor`s, runs rules, emits diagnostics. Front-end-agnostic. |
| `cardinal-cli` | Globs files, runs the engine, prints diagnostics, sets the exit code (for CI gates). |
| `cardinal-vscode` | The VS Code / Cursor / VSCodium extension — live diagnostics + a suppress quick-fix, sharing the same engine. |
| `cardinal-website` | The Astro marketing site (this repo's landing page). |

## Requirements

- Node.js >= 18
- pnpm

## Build & test

```bash
pnpm install
pnpm build        # builds all packages
pnpm test         # builds, then runs the full suite
```

> **Install:** the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=anujchhikara.cardinal-vscode)
> (also on [Open VSX](https://open-vsx.org/extension/anujchhikara/cardinal-vscode)
> for Cursor / VSCodium), or the CLI with `npm i -D cardinal-cli` → `npx cardinal`.

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
const users = await prisma.user.findMany({ where: { active: true } })
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
const users = await prisma.user.findMany({ where: { active: true }, include: { posts: true } })
```

For a fuller tour across Prisma, Drizzle, Mongoose, TypeORM, and raw SQL, run the CLI on
[`examples/anti-patterns.ts`](examples/anti-patterns.ts).

## Machine-readable output (for AI agents)

Cardinal doesn't rewrite your code — but it hands an AI agent everything needed
to. Run with `--format json` and each finding comes with its location, message,
and a reusable `why`/`fix` explanation:

```bash
node packages/cli/dist/bin.js --format json "src/**/*.ts"
```

```jsonc
{
  "tool": "cardinal",
  "version": 1,
  "summary": { "problems": 2, "errors": 1 },
  "findings": [
    {
      "ruleId": "n-plus-one",
      "severity": "error",
      "file": "src/orders.ts",
      "line": 3, "column": 25,
      "message": "Query on \"post\" runs inside a loop (N+1)...",
      "explanation": {
        "why": "A query awaited inside a loop runs once per iteration — 1 + N round trips...",
        "fix": "Hoist the query out of the loop: collect the keys, run one batched query..."
      }
    }
  ]
}
```

The `message` carries the finding's specifics (target table, cardinality from
your knowledge file — the one thing an agent can't infer from source); the
`explanation` carries the reusable reasoning and fix. Point an agent at it
("run `cardinal check --format json` and fix every error") or post it on a PR.
Status notices go to stderr, so stdout stays pure JSON. Cardinal stays 100%
static — it finds and explains; your agent applies the edit.

## Rules

Every diagnostic links here. Severities are defaults — override any of them (or
turn a rule off) with a [config file](#configuration).

### n-plus-one
A query awaited inside a loop (`for`, `while`, `.map`/`.forEach`/`.flatMap`) — 1 + N
round trips. With a knowledge file, provably-small loops are silenced and
provably-large fan-out is escalated. **error** (high-confidence adapters).

### unbounded-read
A read with no filter and no limit — it may scan the whole table. **warning**.

### over-fetch
An unfiltered read on a table the knowledge file marks *large*, when a selective
filter would return far fewer rows. Requires a knowledge file. **warning**.

### order-by-rand
`ORDER BY RAND()` / `RANDOM()` — sorts the entire result set and can't use an
index. **warning**.

### leading-wildcard-like
`LIKE '%…'` / `ILIKE '%…'` — a leading wildcard is non-sargable (full scan).
**warning**.

### excessive-joins
A query joining many tables (JOINs counted by a real SQL parser). Large join
fan-out is hard on the planner. **warning**.

### unindexed-query
A query filtering or sorting on a column no index covers — the database scans
(or sorts) the whole table. Cardinal reads the indexes straight from your
**`schema.prisma`** (`@id`, `@unique`, `@@index`, `@@unique` — compound
leading-column aware), discovered automatically by walking up from the current
directory like the knowledge file. Override with `--schema <path>`, disable
with `--no-schema`. A knowledge file marking the table small silences it.
**warning** (Prisma today; more ORMs next).

```
app.ts:2:10  warning  unindexed-query  Query on "user" filters on "name", but no
index has it as its leading column — the database scans the whole table. Add
`@@index([name])` in schema.prisma.
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

**Don't start from a blank file — run `cardinal init`.** It scans your code and
scaffolds the knowledge file for you: every table you query, plus the exact filter
subsets your code uses (e.g. `status = 'active'`), each with a copy-pasteable
`count(*)` query. You just fill in the numbers.

```bash
node packages/cli/dist/bin.js init     # writes cardinal.knowledge.yaml
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

### Reporting a wrong finding

Cardinal is tuned by real codebases. If a finding is wrong — a false positive,
a missed catch, or a crash — report it with one of the
[issue templates](https://github.com/AnujChhikara/cardinal/issues/new/choose).
After `cardinal suppress` (or the VS Code suppress quick-fix) Cardinal offers a
**pre-filled report link** — review it on GitHub and press Create; nothing is
ever sent automatically. Every confirmed report ships as a permanent regression
test in [`packages/core/test/corpus/`](packages/core/test/corpus/), so a fixed
false positive can never come back.

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

Shipped: config file, a real SQL parser, **context-awareness across all adapters**
(the knowledge file's `over-fetch` / cardinality now work for Drizzle, Mongoose,
and raw SQL, not just Prisma), **machine-readable `--format json`** output (each
finding carries a why/fix explanation, so an AI agent can apply the fix),
**schema-awareness for Prisma** (`unindexed-query` reads indexes from
`schema.prisma`), and releases to the **VS Code Marketplace**, **Open VSX**, and
**npm** (automated on a version tag — see [`PUBLISHING.md`](PUBLISHING.md)). Next:

- Index extraction for Drizzle, TypeORM, and Mongoose schemas (`unindexed-query` beyond Prisma).
- More parser-backed SQL rules: subqueries, `HAVING`/`GROUP BY` misuse, `SELECT *`.
- More engines (MySQL/PlanetScale/Postgres limits) and data layers (Kysely, Sequelize).
- Deep mode: cross-module data-flow checks.

## License

MIT
