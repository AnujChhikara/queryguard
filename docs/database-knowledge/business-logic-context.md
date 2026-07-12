# Business-Logic Context — The Knowledge File

_Last checked against source: 2026-07-12._

Cardinal's structural rules see *shape*, not *scale*: a query in a loop looks
like an N+1 whether the loop runs twice or two million times. The
**knowledge file** gives the analyzer the missing scale information — a static,
human-authored description of how big your tables are and how selective your
common filters are — so it can **silence provably-small loops**, **escalate
provably-large fan-out**, and **suggest narrower reads**.

It stays 100% static: the file is a local YAML document you write and commit.
Nothing is transmitted, no database is connected, no LLM is consulted.

---

## The file

Cardinal discovers `cardinal.knowledge.yaml` (or `.yml` / `.json`) by walking
up from the current directory to the filesystem root — the first match wins. With
no file present, output is byte-identical to running without knowledge.

```yaml
version: 1

# Optional. Row-count buckets. Defaults shown.
thresholds:
  small: 50      # <= small  → "small"  (silence N+1)
  large: 1000    # >= large  → "large"  (escalate N+1)
                 # in between → "medium" (unchanged)

tables:
  user:
    rows: 10000            # cardinality of the whole table
    filters:               # selectivity of common predicates
      - when: { status: active }
        rows: 10           # `where: { status: "active" }` yields ~10 rows
  tag:
    rows: 12

# Written by `cardinal suppress`; you can also hand-edit.
suppressions:
  - rule: n-plus-one
    file: src/contacts.ts
    fn: syncContacts
    anchor: "prisma.contact.findMany({ where: { active: true } })"
    reason: "contact list is admin-curated, always < 20"
    added: "2026-07-12"
```

A **filter fact** matches a query when the query's equality predicates are a
*superset* of the fact's `when` map (every `when` key/value is present in the
query). The tightest matching fact wins.

---

## The three behaviors

### 1. Silence a provably-small loop

If the collection a loop iterates is produced by a query whose cardinality buckets
to **small**, the per-row query cannot be an N+1 of any consequence — the
`n-plus-one` diagnostic is suppressed.

```ts
const active = await prisma.user.findMany({ where: { status: "active" } }); // ~10 (small)
for (const u of active) {
  await prisma.post.findMany({ where: { authorId: u.id } });                // silenced
}
```

The driving-set trace is **conservative**: it resolves only the unambiguous case
— the loop iterates a bare identifier, declared exactly once in the same function,
never reassigned, initialized by a single known query call. Anything else falls
back to `unknown` (today's behavior). Precision over recall: Cardinal never
silences a real N+1 on a guess.

### 2. Escalate provably-large fan-out

If the driving set buckets to **large**, the same loop is amplified N+1 — the
diagnostic stays an **error** and its message names the row count so the severity
is legible:

```
error  n-plus-one  Query on "post" runs once per row of ~10000-row set (N+1 amplified). ...
```

### 3. Suggest a narrower read (`over-fetch`)

An unfiltered read on a table that buckets **large**, where the table also has a
filter fact bucketing **small**, likely loads far more than the caller needs:

```ts
return prisma.user.findMany();   // loads ~10000; a `status=active` (~10) subset likely suffices
```

```
warning  over-fetch  Read on "user" loads all ~10000 rows, but a "status=active" (~10) subset likely suffices. Add a where, or confirm you need the full table.
```

Aggregates (`count`/`aggregate`/`groupBy`) are never flagged.

---

## Inline hints

When a driving set isn't statically traceable (an argument, an imported helper),
annotate the loop directly. A hint leads the enclosing loop statement (or the
`.map`/`.forEach`/`.flatMap` call):

```ts
// cardinal: bounded 10
for (const x of getIds()) {
  await prisma.post.findMany({ where: { authorId: x } });   // treated as small → silenced
}

// cardinal: unbounded
for (const x of getIds()) { ... }                            // treated as large → escalated
```

`bounded` (optionally with a count) marks the set small; `unbounded` marks it
large. Hints take precedence over the driving-set trace.

---

## Suppressing a diagnostic

```
cardinal suppress <file>:<line> [--rule <id>] [--reason <text>] [--yes] [--knowledge <path>]
```

`suppress` locates the single diagnostic on that line (pass `--rule` to
disambiguate when several share a line), records a suppression entry, and — when
the suppressed query resolves to a known small filtered set — offers to promote
that observation into a `tables.<t>.rows` fact you can reuse. `--reason` and
`--yes` bypass the interactive prompts.

Matching is **anchor-based, never by line number**: an entry matches on `rule` +
enclosing `fn` + the normalized full call text (`anchor`) + the file *basename*.
This is deliberately fragile in one direction — reformatting whitespace is fine,
but renaming a variable inside the call lapses the suppression so the warning
returns for re-evaluation. Line numbers drift as you edit above the call;
anchors don't.

> **Caveat:** writing via `suppress` round-trips the YAML (`parse` → mutate →
> `stringify`), which drops hand-written comments. Basename matching also means
> two same-named files with the same fn + anchor + rule would share a suppression.
> Both are acceptable v1 trade-offs; comment-preserving writes and
> project-relative path matching are later refinements.

---

## Sources

- Design spec: [`../superpowers/specs/2026-07-10-business-logic-context-design.md`](../superpowers/specs/2026-07-10-business-logic-context-design.md)
- Implementation plan: [`../superpowers/plans/2026-07-10-business-logic-context.md`](../superpowers/plans/2026-07-10-business-logic-context.md)
