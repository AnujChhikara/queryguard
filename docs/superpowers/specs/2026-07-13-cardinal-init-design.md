# `cardinal init` — Scaffold the Knowledge File

_Date: 2026-07-13._

**Relates to:** [Business-Logic Context](2026-07-10-business-logic-context-design.md)
(the knowledge file), [Context-Aware Adapters](2026-07-13-context-aware-adapters-design.md)
(predicate extraction, which this builds on).

## 1. Goal

Turn the knowledge file from "author by hand" into "one command + fill in a few
numbers." `cardinal init` scans a codebase, and from the queries themselves emits
a starter `cardinal.knowledge.yaml` containing every table your code touches **and
the exact filter subsets your code already queries by** — each with a `rows:`
placeholder and a copy-pasteable count query. The user only supplies the numbers.

## 2. The division of labor (why this is useful, not a blank page)

Two things `init` can't invent — and shouldn't try:

- **Row counts** ("how many users") — runtime data; only the user/DB knows.
- **Which subsets matter** ("active users") — business context.

But the second is *already in the code*: thanks to predicate extraction, every
query yields its `WHERE` predicates. So `init` detects that the code queries
`users WHERE status = 'active'` and scaffolds it as a candidate fact. **Cardinal
identifies the structure (tables + the subsets you query by); the user fills in
only the counts** — and even that is made trivial with generated `count(*)`
snippets. `init` never asks "what should I track?" — it reads the answer from the
code.

## 3. Behavior

`cardinal init [glob]` (default glob `**/*.{ts,js,tsx,jsx}`):

1. Glob files (relative to cwd), read each, and collect `QueryDescriptor[]` across
   **all adapters** (Prisma, Drizzle, Mongoose, raw SQL).
2. Group by `target` (table/model/collection). Skip descriptors with no target or
   heuristic confidence (avoid guessed tables).
3. For each table, collect **candidate filter facts**: distinct `filters[]` entries
   with `kind:"eq"`, a **concrete literal value**, and a **non-id field** (drop
   `id`, `_id`, and `*Id`/`*_id` — those are point lookups, not subsets). Dedup by
   `(field,value)`, annotate each with the times it was seen, and sort by frequency
   (desc).
4. Emit `cardinal.knowledge.yaml` to cwd.

**Guards:** if the file already exists, refuse with a message unless `--force` is
passed (v1 does not merge — that's a later "keep it fresh" feature).

## 4. Output

Generated as a **string template** (not `yaml.stringify`) so the guiding comments
survive:

```yaml
version: 1
# Fill in real row counts and prune any filters you don't care about, then
# Cardinal reasons about your data's scale.
# Docs: https://github.com/AnujChhikara/cardinal#business-logic-context
thresholds:
  small: 50
  large: 1000
tables:
  users:
    rows:  # total rows — SELECT count(*) FROM users;
    filters:
      - when: { status: active }  # seen 7×
        rows:  # SELECT count(*) FROM users WHERE status = 'active';
      - when: { archived: false }  # seen 3×
        rows:  # SELECT count(*) FROM users WHERE archived = false;
  contacts:
    rows:  # total rows — db.contacts.countDocuments();
```

**Count-hint comments are per-ORM:** SQL `SELECT count(*) …` for
Prisma/Drizzle/raw-SQL tables; `db.<table>.countDocuments(…)` for Mongoose. A
table's ORM is taken from its descriptors (all queries to one table share an ORM
in practice; ties break to SQL).

A parsed empty-`rows` field yields no fact (the loader ignores non-numeric `rows`),
so a freshly-scaffolded file is inert until the user fills in numbers — no false
findings from placeholders.

## 5. Components

- **core** — two exports:
  - `collectQueries(code, filePath?): QueryDescriptor[]` — the adapter loop, lifted
    out of `analyzeSource` (which now calls it too). Reusable by any surface.
  - `buildKnowledgeScaffold(descriptors: QueryDescriptor[]): string` in
    `knowledge/scaffold.ts` — pure descriptors → YAML string. Testable, no I/O.
- **cli** — `src/init.ts` `initCommand(patterns, cwd, opts): { code; message }`:
  globs, reads, calls `collectQueries` per file, concatenates, calls
  `buildKnowledgeScaffold`, writes the file (honoring `--force`). `bin.ts`
  dispatches the `init` subcommand.

## 6. Loader tolerance

The scaffold writes `rows:` with **no value** (empty). `parseKnowledge` /
`estimateCardinality` already ignore a table/fact whose `rows` isn't a number, so
an unfilled scaffold is safely inert. Confirm with a test.

## 7. Testing

- `buildKnowledgeScaffold` (core, pure): a mixed-adapter descriptor set →
  expected tables, candidate filters (eq-literal, non-id), frequency annotations,
  per-ORM count hints; id-fields excluded; interpolated/`in`/range predicates
  excluded from facts.
- `collectQueries`: returns targets across all adapters for a sample.
- `initCommand` (cli, temp dir): writes the file; refuses when it exists; `--force`
  overwrites; the written file round-trips through `parseKnowledge` as inert
  (no numeric rows).

## 8. Out of scope (later)

- Merging into an existing knowledge file / a "refresh" mode.
- Parsing a Prisma/Drizzle schema for enum/boolean field suggestions.
- Interactive prompts / auto-running counts (stays 100% static — no DB connection).
