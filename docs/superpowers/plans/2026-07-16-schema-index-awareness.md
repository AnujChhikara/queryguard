# Schema/Index Awareness (unindexed-query) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cardinal parses `schema.prisma`, learns which columns are indexed, and flags queries that filter or sort on a column no index covers — "this query's column has no index, so the database scans the whole table."

**Architecture:** A new `packages/core/src/schema/` module parses Prisma schema files into a `SchemaInfo` (per-model scalar fields + ordered index column lists) with zero new dependencies (line-based parser). `QueryDescriptor` gains `orderByFields`; the Prisma adapter extracts `orderBy`. A new `unindexed-query` rule consumes `ctx.schema`, gated hard for precision (only high-confidence descriptors of the matching ORM, only fields known to be scalar columns, silenced for knowledge-file-provably-small tables). CLI and VS Code discover the schema file the same way they discover the knowledge file.

**Tech Stack:** TypeScript (strict), ts-morph, vitest, pnpm monorepo, tsup.

## Global Constraints

- Node.js >= 18; no new runtime dependencies in any package.
- Precision over recall: when the code can't be read statically (opaque args, `AND`/`OR` composites, relation filters), the rule stays silent rather than guessing.
- All core tests run from `packages/core` with `npx vitest run <file>`; full suite via `pnpm test` at repo root.
- Follow existing code style: `.js` import specifiers, `Node.isX` guards, one rule per file, rule docs anchor `https://github.com/AnujChhikara/cardinal#<rule-id>`.
- Commit after every task with a conventional-commit message.

## File Structure

- `packages/core/src/schema/types.ts` — `ModelSchema`, `SchemaInfo` types (new)
- `packages/core/src/schema/prisma.ts` — `parsePrismaSchema()` (new)
- `packages/core/src/schema/discover.ts` — `loadSchema()`, `discoverSchema()` (new)
- `packages/core/src/rules/unindexed-query.ts` — the rule (new)
- `packages/core/src/types.ts` — add `orderByFields` to `QueryDescriptor`, `schema` to `RuleContext`
- `packages/core/src/adapters/prisma.ts` — extract `orderBy`
- `packages/core/src/rules/explanations.ts` — add `unindexed-query` why/fix
- `packages/core/src/engine.ts` — register rule, add `schema` param to `analyzeSource`
- `packages/core/src/index.ts` — export schema module
- `packages/cli/src/bin.ts`, `packages/cli/src/run.ts` — `--schema` / `--no-schema`, discovery, pass-through
- `packages/vscode/src/schema-cache.ts` (new), `packages/vscode/src/analyze.ts`, `packages/vscode/src/extension.ts` — live diagnostics
- `README.md`, `CHANGELOG.md` — docs

---

### Task 1: Prisma schema parser

**Files:**
- Create: `packages/core/src/schema/types.ts`
- Create: `packages/core/src/schema/prisma.ts`
- Test: `packages/core/test/schema/prisma.test.ts`

**Interfaces:**
- Produces: `ModelSchema { fields: string[]; indexes: string[][] }`, `SchemaInfo { orm: string; filePath: string; models: Record<string, ModelSchema> }`, `parsePrismaSchema(text: string, filePath: string): SchemaInfo | null`. Models are keyed by the **client-side** name (`model UserProfile` → key `userProfile`, i.e. first letter lowercased). `indexes[i][0]` is the leading column. Relation fields (typed as another model) are excluded from `fields`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/schema/prisma.test.ts
import { describe, it, expect } from "vitest";
import { parsePrismaSchema } from "../../src/schema/prisma.js";

const SCHEMA = `
datasource db { provider = "postgresql" }

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id       Int    @id
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
  orgId    Int
  slug     String

  @@index([orgId, slug])
  @@unique([authorId, slug], map: "author_slug")
}
`;

describe("parsePrismaSchema", () => {
  it("keys models by client name and collects scalar fields", () => {
    const s = parsePrismaSchema(SCHEMA, "/p/schema.prisma");
    expect(s).not.toBeNull();
    expect(Object.keys(s!.models).sort()).toEqual(["post", "user"]);
    expect(s!.models.user.fields).toEqual(["id", "email", "name", "createdAt"]);
  });

  it("excludes relation fields from fields", () => {
    const s = parsePrismaSchema(SCHEMA, "/p/schema.prisma");
    expect(s!.models.post.fields).not.toContain("author");
    expect(s!.models.user.fields).not.toContain("posts");
  });

  it("collects @id/@unique and @@index/@@unique with column order", () => {
    const s = parsePrismaSchema(SCHEMA, "/p/schema.prisma");
    expect(s!.models.user.indexes).toContainEqual(["id"]);
    expect(s!.models.user.indexes).toContainEqual(["email"]);
    expect(s!.models.post.indexes).toContainEqual(["orgId", "slug"]);
    expect(s!.models.post.indexes).toContainEqual(["authorId", "slug"]);
  });

  it("handles sort annotations in index field lists", () => {
    const s = parsePrismaSchema(
      "model A {\n  id Int @id\n  ts DateTime\n  @@index([ts(sort: Desc)])\n}",
      "/p/s",
    );
    expect(s!.models.a.indexes).toContainEqual(["ts"]);
  });

  it("returns null for text with no models", () => {
    expect(parsePrismaSchema("SELECT 1;", "/p/x")).toBeNull();
  });

  it("ignores commented-out lines", () => {
    const s = parsePrismaSchema(
      "model A {\n  id Int @id\n  // ghost String @unique\n}",
      "/p/s",
    );
    expect(s!.models.a.fields).toEqual(["id"]);
    expect(s!.models.a.indexes).toEqual([["id"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/schema/prisma.test.ts`
Expected: FAIL — cannot resolve `../../src/schema/prisma.js`.

- [ ] **Step 3: Write the types and parser**

```ts
// packages/core/src/schema/types.ts
/** Index/field facts for one model, extracted from an ORM schema file. */
export interface ModelSchema {
  /** Scalar/enum field names — the queryable columns. Relation fields are excluded. */
  fields: string[];
  /**
   * Each declared index as its ordered column list; [0] is the leading column.
   * Includes @id, @unique, @@id, @@unique and @@index declarations.
   */
  indexes: string[][];
}

export interface SchemaInfo {
  /** Which adapter's descriptors this schema describes (matches QueryDescriptor.orm). */
  orm: string;
  /** Absolute path of the schema file — used in diagnostics. */
  filePath: string;
  /** Keyed by the client-side model name (`prisma.user` → "user"). */
  models: Record<string, ModelSchema>;
}
```

```ts
// packages/core/src/schema/prisma.ts
import type { ModelSchema, SchemaInfo } from "./types.js";

/** `UserProfile` → `userProfile` — the Prisma client property for a model. */
function clientName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** `"orgId, slug(sort: Desc)"` → `["orgId", "slug"]`. */
function parseFieldList(inner: string): string[] {
  return inner
    .split(",")
    .map((part) => part.trim().split(/[(\s]/, 1)[0])
    .filter((name) => name.length > 0);
}

const MODEL_OPEN = /^\s*model\s+([A-Za-z_]\w*)\s*\{/;
const BLOCK_ATTR = /^\s*@@(?:id|unique|index)\s*\(\s*\[([^\]]*)\]/;
const FIELD_LINE = /^\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(?:\[\])?\??/;

/**
 * Line-based parser for schema.prisma — deliberately dependency-free. It only
 * needs field names and index column lists, not the full PSL grammar.
 */
export function parsePrismaSchema(text: string, filePath: string): SchemaInfo | null {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, ""));

  // Pass 1: model names, so relation fields (typed as another model) can be
  // told apart from scalar/enum columns.
  const modelNames = new Set<string>();
  for (const line of lines) {
    const m = MODEL_OPEN.exec(line);
    if (m) modelNames.add(m[1]);
  }
  if (modelNames.size === 0) return null;

  const models: Record<string, ModelSchema> = {};
  let current: { name: string; schema: ModelSchema } | null = null;
  for (const line of lines) {
    if (!current) {
      const m = MODEL_OPEN.exec(line);
      if (m) current = { name: m[1], schema: { fields: [], indexes: [] } };
      continue;
    }
    if (/^\s*\}/.test(line)) {
      models[clientName(current.name)] = current.schema;
      current = null;
      continue;
    }
    const block = BLOCK_ATTR.exec(line);
    if (block) {
      const fields = parseFieldList(block[1]);
      if (fields.length > 0) current.schema.indexes.push(fields);
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (!field) continue;
    const [, name, baseType] = field;
    if (modelNames.has(baseType)) continue; // relation, not a queryable column
    current.schema.fields.push(name);
    if (/@id\b/.test(line) || /@unique\b/.test(line)) current.schema.indexes.push([name]);
  }
  return { orm: "prisma", filePath, models };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/schema/prisma.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema packages/core/test/schema
git commit -m "feat(core): parse schema.prisma into per-model field/index facts"
```

---

### Task 2: Schema discovery

**Files:**
- Create: `packages/core/src/schema/discover.ts`
- Test: `packages/core/test/schema/discover.test.ts`

**Interfaces:**
- Consumes: `parsePrismaSchema` from Task 1.
- Produces: `loadSchema(filePath: string): SchemaInfo | null`, `discoverSchema(fromDir: string): SchemaInfo | null`. Discovery walks up from `fromDir` checking `prisma/schema.prisma` then `schema.prisma` in each directory (mirrors `discoverKnowledge` in `packages/core/src/knowledge/load.ts:59-71`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/schema/discover.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSchema, loadSchema } from "../../src/schema/discover.js";

const MODEL = "model User {\n  id Int @id\n  name String\n}\n";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cardinal-schema-"));
  mkdirSync(join(root, "prisma"));
  writeFileSync(join(root, "prisma", "schema.prisma"), MODEL);
  mkdirSync(join(root, "src", "deep"), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("discoverSchema", () => {
  it("finds prisma/schema.prisma walking up from a nested dir", () => {
    const s = discoverSchema(join(root, "src", "deep"));
    expect(s).not.toBeNull();
    expect(s!.models.user.fields).toContain("name");
  });

  it("returns null when nothing is found", () => {
    const empty = mkdtempSync(join(tmpdir(), "cardinal-empty-"));
    try {
      expect(discoverSchema(empty)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("loadSchema", () => {
  it("loads an explicit path", () => {
    const s = loadSchema(join(root, "prisma", "schema.prisma"));
    expect(s?.orm).toBe("prisma");
  });

  it("returns null for a missing file", () => {
    expect(loadSchema(join(root, "nope.prisma"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/schema/discover.test.ts`
Expected: FAIL — cannot resolve `../../src/schema/discover.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/schema/discover.ts
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { parsePrismaSchema } from "./prisma.js";
import type { SchemaInfo } from "./types.js";

const CANDIDATES = ["prisma/schema.prisma", "schema.prisma"];

export function loadSchema(filePath: string): SchemaInfo | null {
  if (!existsSync(filePath)) return null;
  try {
    return parsePrismaSchema(readFileSync(filePath, "utf8"), filePath);
  } catch {
    return null;
  }
}

/** Walks up from `fromDir` looking for a Prisma schema, like discoverKnowledge. */
export function discoverSchema(fromDir: string): SchemaInfo | null {
  let dir = fromDir;
  while (true) {
    for (const rel of CANDIDATES) {
      const candidate = join(dir, rel);
      if (existsSync(candidate)) return loadSchema(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir || parsePath(dir).root === dir) return null;
    dir = parent;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/schema/discover.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema/discover.ts packages/core/test/schema/discover.test.ts
git commit -m "feat(core): discover prisma schema by walking up from cwd"
```

---

### Task 3: `orderByFields` on QueryDescriptor + Prisma adapter extraction

**Files:**
- Modify: `packages/core/src/types.ts` (QueryDescriptor)
- Modify: `packages/core/src/adapters/prisma.ts` (readOptions + descriptor)
- Test: `packages/core/test/adapters/prisma.test.ts` (append a describe block)

**Interfaces:**
- Produces: `QueryDescriptor.orderByFields?: string[]` — property names from a Prisma `orderBy` object (`orderBy: { createdAt: "desc" }` → `["createdAt"]`) or array (`orderBy: [{ a: "asc" }, { b: "desc" }]` → `["a", "b"]`; element order preserved). `undefined` when there is no `orderBy` or it isn't statically readable.

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/adapters/prisma.test.ts` (reuse the file's existing helper for building descriptors if one exists; otherwise use this pattern):

```ts
describe("prismaAdapter orderBy extraction", () => {
  function one(code: string) {
    const sf = parseSource(code);
    const d = findCallExpressions(sf).map((c) => prismaAdapter(c)).find((x) => x !== null);
    expect(d).toBeTruthy();
    return d!;
  }

  it("extracts a single-field orderBy", () => {
    const d = one(`async function f(prisma){ return prisma.user.findMany({ orderBy: { createdAt: "desc" } }); }`);
    expect(d.orderByFields).toEqual(["createdAt"]);
  });

  it("extracts array-form orderBy preserving order", () => {
    const d = one(`async function f(prisma){ return prisma.user.findMany({ orderBy: [{ name: "asc" }, { id: "desc" }] }); }`);
    expect(d.orderByFields).toEqual(["name", "id"]);
  });

  it("leaves orderByFields undefined when absent or opaque", () => {
    expect(one(`async function f(prisma){ return prisma.user.findMany({}); }`).orderByFields).toBeUndefined();
    expect(one(`async function f(prisma, ob){ return prisma.user.findMany({ orderBy: ob }); }`).orderByFields).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/adapters/prisma.test.ts`
Expected: FAIL — `orderByFields` is `undefined` where `["createdAt"]` expected (first test).

- [ ] **Step 3: Implement.** In `packages/core/src/types.ts`, after `filters?: QueryFilter[];` (line 46) add:

```ts
  /** Column names from an ORDER BY / orderBy clause, leading column first. */
  orderByFields?: string[];
```

In `packages/core/src/adapters/prisma.ts`, extend `readOptions`'s return type and body — add to the returned object type `orderByFields: string[] | undefined`, return `orderByFields: undefined` in the two early-return branches, and before the final `return` add:

```ts
  const orderByProp = firstArg.getProperty("orderBy");
  let orderByFields: string[] | undefined;
  if (orderByProp && Node.isPropertyAssignment(orderByProp)) {
    const init = orderByProp.getInitializer();
    if (init && Node.isObjectLiteralExpression(init)) {
      orderByFields = init.getProperties().filter(Node.isPropertyAssignment).map((p) => p.getName());
    } else if (init && Node.isArrayLiteralExpression(init)) {
      orderByFields = init
        .getElements()
        .filter(Node.isObjectLiteralExpression)
        .flatMap((el) => el.getProperties().filter(Node.isPropertyAssignment).map((p) => p.getName()));
    }
  }
```

…and include `orderByFields` in the returned options object, then in `prismaAdapter`'s returned descriptor add `orderByFields: options.orderByFields,`.

- [ ] **Step 4: Run the adapter tests and full core suite**

Run: `cd packages/core && npx vitest run test/adapters/prisma.test.ts && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/adapters/prisma.ts packages/core/test/adapters/prisma.test.ts
git commit -m "feat(core): extract orderBy fields into QueryDescriptor (prisma)"
```

---

### Task 4: The `unindexed-query` rule + explanation

**Files:**
- Create: `packages/core/src/rules/unindexed-query.ts`
- Modify: `packages/core/src/types.ts` (RuleContext)
- Modify: `packages/core/src/rules/explanations.ts`
- Test: `packages/core/test/rules/unindexed-query.test.ts`

**Interfaces:**
- Consumes: `SchemaInfo`/`ModelSchema` (Task 1), `orderByFields` (Task 3), `bucket` from `packages/core/src/knowledge/cardinality.js`.
- Produces: `unindexedQueryRule: Rule` with `id: "unindexed-query"`, `defaultSeverity: "warning"`; `RuleContext.schema?: SchemaInfo | null`.

**Precision gates (all must hold to flag):** schema present; `d.orm === schema.orm`; `d.confidence === "high"`; `d.operation === "read"`; model found; knowledge (if present) does not mark the table small; no `AND`/`OR`/`NOT` composite filters; only filter fields that are known scalar columns are considered; flags only when **no** considered filter field is the leading column of any index. Sort check fires only when the query also has no indexed filter. At most one diagnostic per query (filter finding wins over sort finding).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/rules/unindexed-query.test.ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { parsePrismaSchema } from "../../src/schema/prisma.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import { unindexedQueryRule } from "../../src/rules/unindexed-query.js";
import type { QueryDescriptor } from "../../src/types.js";

const schema = parsePrismaSchema(
  `model User {
  id        Int      @id
  email     String   @unique
  name      String
  createdAt DateTime
  posts     Post[]
}

model Post {
  id     Int    @id
  orgId  Int
  slug   String
  @@index([orgId, slug])
}`,
  "/p/prisma/schema.prisma",
);

function descriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf).map((c) => prismaAdapter(c)).filter((d): d is QueryDescriptor => d !== null);
}

describe("unindexedQueryRule", () => {
  it("flags a filter on an unindexed column", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { name: "x" } }); }`), schema };
    const diags = unindexedQueryRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("unindexed-query");
    expect(diags[0].message).toContain('"name"');
    expect(diags[0].message).toContain("no index");
  });

  it("stays silent when the filter hits an indexed column (@unique, @id)", () => {
    for (const where of [`{ email: "a@b.c" }`, `{ id: 1 }`, `{ email: "a@b.c", name: "x" }`]) {
      const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: ${where} }); }`), schema };
      expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
    }
  });

  it("understands compound-index leading columns", () => {
    const flagged = { descriptors: descriptors(`async function f(p){ return p.post.findMany({ where: { slug: "s" } }); }`), schema };
    const diags = unindexedQueryRule.match(flagged);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("orgId"); // hints at the partial compound index
    const ok = { descriptors: descriptors(`async function f(p){ return p.post.findMany({ where: { orgId: 1 } }); }`), schema };
    expect(unindexedQueryRule.match(ok)).toHaveLength(0);
  });

  it("flags an unindexed sort on an unfiltered read", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ orderBy: { createdAt: "desc" } }); }`), schema };
    const diags = unindexedQueryRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('"createdAt"');
    expect(diags[0].message).toContain("sort");
  });

  it("does not flag an unindexed sort when the filter is indexed", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { email: "a@b.c" }, orderBy: { createdAt: "desc" } }); }`), schema };
    expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
  });

  it("emits at most one diagnostic per query (unindexed filter + unindexed sort)", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { name: "x" }, orderBy: { createdAt: "desc" } }); }`), schema };
    expect(unindexedQueryRule.match(ctx)).toHaveLength(1);
  });

  it("skips relation filters, logical composites, unknown models, and writes", () => {
    for (const code of [
      `async function f(p){ return p.user.findMany({ where: { posts: { some: { id: 1 } } } }); }`,
      `async function f(p){ return p.user.findMany({ where: { OR: [{ name: "a" }, { name: "b" }] } }); }`,
      `async function f(p){ return p.invoice.findMany({ where: { ref: "x" } }); }`,
      `async function f(p){ return p.user.updateMany({ where: { name: "x" }, data: {} }); }`,
    ]) {
      const ctx = { descriptors: descriptors(code), schema };
      expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
    }
  });

  it("is silenced by a knowledge file that marks the table small", () => {
    const knowledge = parseKnowledge(`version: 1\ntables:\n  user:\n    rows: 20\n`, "/p");
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { name: "x" } }); }`), schema, knowledge };
    expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
  });

  it("does nothing without a schema", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { name: "x" } }); }`) };
    expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/rules/unindexed-query.test.ts`
Expected: FAIL — cannot resolve `../../src/rules/unindexed-query.js`.

- [ ] **Step 3: Implement.** In `packages/core/src/types.ts`: add `import type { SchemaInfo } from "./schema/types.js";`, re-export it (`export type { SchemaInfo, ModelSchema } from "./schema/types.js";`), and add to `RuleContext`:

```ts
  schema?: SchemaInfo | null;
```

Create the rule:

```ts
// packages/core/src/rules/unindexed-query.ts
import { basename } from "node:path";
import type { Rule, Diagnostic } from "../types.js";
import { makeDiagnostic } from "../types.js";
import { bucket } from "../knowledge/cardinality.js";

const LOGICAL = new Set(["AND", "OR", "NOT"]);
const DOCS = "https://github.com/AnujChhikara/cardinal#unindexed-query";

export const unindexedQueryRule: Rule = {
  id: "unindexed-query",
  defaultSeverity: "warning",
  match(ctx) {
    const schema = ctx.schema;
    if (!schema) return [];
    const out: Diagnostic[] = [];
    const schemaFile = basename(schema.filePath);

    for (const d of ctx.descriptors) {
      if (d.orm !== schema.orm || d.confidence !== "high" || d.operation !== "read") continue;
      const model = schema.models[d.target];
      if (!model) continue;

      // A provably-small table is cheap to scan — the knowledge file wins.
      const k = ctx.knowledge;
      const rows = k?.tables[d.target]?.rows;
      if (k && typeof rows === "number" && bucket(rows, k.thresholds) === "small") continue;

      const leading = new Set(model.indexes.map((ix) => ix[0]));
      const filters = d.filters ?? [];
      // Composite filters (AND/OR/NOT) aren't statically readable — stay silent.
      if (filters.some((f) => LOGICAL.has(f.field))) continue;
      // Only reason about fields we know are scalar columns of this model.
      const known = filters.filter((f) => model.fields.includes(f.field));
      const anyIndexed = known.some((f) => leading.has(f.field));

      if (known.length > 0 && !anyIndexed) {
        const names = known.map((f) => `"${f.field}"`).join(", ");
        const partial = model.indexes.find((ix) =>
          ix.slice(1).some((col) => known.some((f) => f.field === col)),
        );
        const hint = partial
          ? ` An index [${partial.join(", ")}] exists, but it only helps queries that also filter on "${partial[0]}".`
          : "";
        out.push(
          makeDiagnostic({
            ruleId: "unindexed-query",
            severity: "warning",
            message: `Query on "${d.target}" filters on ${names}, but no index has ${known.length > 1 ? "any of them" : "it"} as its leading column — the database scans the whole table.${hint} Add \`@@index([${known[0].field}])\` in ${schemaFile}.`,
            node: d.node,
            docsUrl: DOCS,
          }),
        );
        continue; // one diagnostic per query
      }

      const sortField = d.orderByFields?.[0];
      if (sortField && model.fields.includes(sortField) && !leading.has(sortField) && !anyIndexed) {
        out.push(
          makeDiagnostic({
            ruleId: "unindexed-query",
            severity: "warning",
            message: `Query on "${d.target}" sorts by "${sortField}", which has no index — the database sorts the entire table on every call. Add \`@@index([${sortField}])\` in ${schemaFile}.`,
            node: d.node,
            docsUrl: DOCS,
          }),
        );
      }
    }
    return out;
  },
};
```

In `packages/core/src/rules/explanations.ts`, add to `ruleExplanations`:

```ts
  "unindexed-query": {
    why: "A filter or sort on a column no index covers can't use an index seek — the database reads (or sorts) every row in the table, so latency grows linearly with table size. For a compound index, only queries constraining its leading column can use it.",
    fix: "Add an index whose leading column is the filtered/sorted field (Prisma: `@@index([field])` in schema.prisma), or filter on an already-indexed column.",
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/rules/unindexed-query.test.ts && npx vitest run test/rules/explanations.test.ts`
Expected: PASS. (If `explanations.test.ts` asserts an exact rule list, add `"unindexed-query"` to it.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rules/unindexed-query.ts packages/core/src/rules/explanations.ts packages/core/src/types.ts packages/core/test/rules/unindexed-query.test.ts
git commit -m "feat(core): unindexed-query rule — flag filters/sorts no index covers"
```

---

### Task 5: Engine + exports wiring

**Files:**
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/engine.test.ts` (append)

**Interfaces:**
- Produces: `analyzeSource(code, filePath?, knowledge?, config?, schema?: SchemaInfo | null): Diagnostic[]` (5th param optional → fully backward compatible). `cardinal-core` exports `parsePrismaSchema`, `loadSchema`, `discoverSchema`, `SchemaInfo`, `ModelSchema`, `unindexedQueryRule`.

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/engine.test.ts`:

```ts
import { parsePrismaSchema } from "../src/schema/prisma.js";

describe("analyzeSource with schema", () => {
  const schema = parsePrismaSchema("model User {\n  id Int @id\n  name String\n}", "/p/schema.prisma");

  it("reports unindexed-query when a schema is provided", () => {
    const diags = analyzeSource(
      `async function f(prisma){ return prisma.user.findMany({ where: { name: "x" } }); }`,
      "f.ts",
      null,
      null,
      schema,
    );
    expect(diags.some((d) => d.ruleId === "unindexed-query")).toBe(true);
  });

  it("is unchanged without a schema", () => {
    const diags = analyzeSource(
      `async function f(prisma){ return prisma.user.findMany({ where: { name: "x" } }); }`,
      "f.ts",
    );
    expect(diags.some((d) => d.ruleId === "unindexed-query")).toBe(false);
  });
});
```

(Adjust the import/describe placement to the file's existing style; `analyzeSource` is already imported there.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/engine.test.ts`
Expected: FAIL — no `unindexed-query` diagnostic (rule not registered / schema not threaded).

- [ ] **Step 3: Implement.** In `packages/core/src/engine.ts`:
  - Import: `import { unindexedQueryRule } from "./rules/unindexed-query.js";` and `import type { SchemaInfo } from "./schema/types.js";`
  - Add `unindexedQueryRule` to the `rules` array.
  - Change the signature: `export function analyzeSource(code, filePath?, knowledge?, config?, schema?: SchemaInfo | null): Diagnostic[]` and build the context as `const ctx = { descriptors, knowledge, schema, cardinalityOf, loopBoundOf };`

  In `packages/core/src/index.ts` add:

```ts
export * from "./schema/types.js";
export * from "./schema/prisma.js";
export * from "./schema/discover.js";
export * from "./rules/unindexed-query.js";
```

- [ ] **Step 4: Run the full core suite**

Run: `cd packages/core && npx vitest run`
Expected: PASS — all files, no regressions (`false-positives.test.ts` in particular).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/engine.ts packages/core/src/index.ts packages/core/test/engine.test.ts
git commit -m "feat(core): thread SchemaInfo through analyzeSource and register unindexed-query"
```

---

### Task 6: CLI `--schema` / `--no-schema` + discovery

**Files:**
- Modify: `packages/cli/src/bin.ts`
- Modify: `packages/cli/src/run.ts`
- Test: `packages/cli/test/run.test.ts` (append)

**Interfaces:**
- Consumes: `discoverSchema`, `loadSchema`, `SchemaInfo` from `cardinal-core` (Task 5).
- Produces: `run(patterns, cwd, options)` accepts `schema?: SchemaInfo | null` in options and forwards it as the 5th arg to `analyzeSource`. CLI: `--schema <path>` (explicit), `--no-schema` (disable), default = `discoverSchema(process.cwd())`; on success prints `cardinal: using schema from <path>` to **stderr** (stdout stays pure for `--format json`).

- [ ] **Step 1: Write the failing test** — append to `packages/cli/test/run.test.ts` (match the file's existing tmp-dir fixture style):

```ts
import { parsePrismaSchema } from "cardinal-core";

it("passes a schema through to the engine (unindexed-query fires)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cardinal-cli-schema-"));
  try {
    await writeFile(
      join(dir, "app.ts"),
      `async function f(prisma){ return prisma.user.findMany({ where: { name: "x" } }); }`,
    );
    const schema = parsePrismaSchema("model User {\n  id Int @id\n  name String\n}", join(dir, "schema.prisma"));
    const { diagnostics } = await run(["app.ts"], dir, { schema });
    expect(diagnostics.some((d) => d.ruleId === "unindexed-query")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter cardinal-core build && cd packages/cli && npx vitest run test/run.test.ts`
Expected: FAIL — `run` ignores `options.schema`, no `unindexed-query` diagnostic. (Core must be rebuilt first so `cardinal-core` exports `parsePrismaSchema`.)

- [ ] **Step 3: Implement.** In `packages/cli/src/run.ts`: add `schema?: SchemaInfo | null` to the options type (import the type from `cardinal-core`) and pass it: `analyzeSource(code, abs, options.knowledge ?? null, options.config ?? null, options.schema ?? null)`.

  In `packages/cli/src/bin.ts`:
  - `parseArgs`: add `schemaPath?: string` and `noSchema: boolean`; parse `--schema` (consumes next arg) and `--no-schema`.
  - In `main()` after the config block:

```ts
  let schema: SchemaInfo | null = null;
  if (!noSchema) {
    schema = schemaPath ? loadSchema(schemaPath) : discoverSchema(process.cwd());
    if (schema) console.error(`cardinal: using schema from ${schema.filePath}`);
  }
```

  - Pass `schema` into `run(patterns, process.cwd(), { knowledge, config, schema })`.
  - Update the usage string's first line to `cardinal [--knowledge <path>] [--no-knowledge] [--schema <path>] [--no-schema] [--no-config] [--format text|json] <glob> [glob...]`.
  - Imports: `loadSchema`, `discoverSchema` and `type SchemaInfo` from `cardinal-core`.

- [ ] **Step 4: Run the CLI suite**

Run: `cd packages/cli && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/bin.ts packages/cli/src/run.ts packages/cli/test/run.test.ts
git commit -m "feat(cli): discover schema.prisma; --schema/--no-schema flags"
```

---

### Task 7: VS Code extension wiring

**Files:**
- Create: `packages/vscode/src/schema-cache.ts`
- Modify: `packages/vscode/src/analyze.ts`
- Modify: `packages/vscode/src/extension.ts`
- Test: `packages/vscode/test/schema-cache.test.ts`

**Interfaces:**
- Consumes: `discoverSchema`, `SchemaInfo` from `cardinal-core`.
- Produces: `SchemaCache` with `get(dir): SchemaInfo | null` and `clear()` (mirrors `KnowledgeCache` at `packages/vscode/src/knowledge-cache.ts`); `toVsDiagnostics(code, fileName, knowledge?, config?, schema?)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/vscode/test/schema-cache.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchemaCache } from "../src/schema-cache.js";

describe("SchemaCache", () => {
  it("discovers and caches a schema; clear() re-reads", () => {
    const root = mkdtempSync(join(tmpdir(), "cardinal-vsc-schema-"));
    try {
      mkdirSync(join(root, "prisma"));
      writeFileSync(join(root, "prisma", "schema.prisma"), "model User {\n  id Int @id\n}\n");
      const cache = new SchemaCache();
      expect(cache.get(root)?.models.user).toBeTruthy();
      // Remove the file: the cached hit must survive until clear().
      rmSync(join(root, "prisma", "schema.prisma"));
      expect(cache.get(root)?.models.user).toBeTruthy();
      cache.clear();
      expect(cache.get(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter cardinal-core build && cd packages/vscode && npx vitest run test/schema-cache.test.ts`
Expected: FAIL — cannot resolve `../src/schema-cache.js`.

- [ ] **Step 3: Implement.**

```ts
// packages/vscode/src/schema-cache.ts
import { discoverSchema, type SchemaInfo } from "cardinal-core";

/**
 * Caches schema-file discovery by directory, mirroring KnowledgeCache — the
 * upward filesystem walk is too costly for the on-type hot path. Misses are
 * memoized as null until clear() (e.g. when a schema.prisma changes on disk).
 */
export class SchemaCache {
  private readonly cache = new Map<string, SchemaInfo | null>();

  get(dir: string): SchemaInfo | null {
    const hit = this.cache.get(dir);
    if (hit !== undefined) return hit;
    const schema = discoverSchema(dir);
    this.cache.set(dir, schema);
    return schema;
  }

  clear(): void {
    this.cache.clear();
  }
}
```

  In `packages/vscode/src/analyze.ts`: import `type SchemaInfo` from `cardinal-core`, add the parameter `schema?: SchemaInfo | null` after `config`, and pass it through: `analyzeSource(code, fileName, knowledge ?? null, config ?? null, schema ?? null)`.

  In `packages/vscode/src/extension.ts`:
  - `import { SchemaCache } from "./schema-cache.js";`
  - In `activate()` next to the other caches: `const schemaCache = new SchemaCache();`
  - In `analyzeDocument()`: `const schema = schemaCache.get(dir);` and pass it: `toVsDiagnostics(doc.getText(), doc.fileName, knowledge, config, schema)`.
  - In `refreshKnowledge()`: add `schemaCache.clear();`
  - Add a watcher alongside the existing two: `const schemaWatcher = vscode.workspace.createFileSystemWatcher("**/schema.prisma");` and include it in the `for (const w of [knowledgeWatcher, configWatcher, schemaWatcher])` loop.

- [ ] **Step 4: Run the vscode suite**

Run: `cd packages/vscode && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vscode/src/schema-cache.ts packages/vscode/src/analyze.ts packages/vscode/src/extension.ts packages/vscode/test/schema-cache.test.ts
git commit -m "feat(vscode): live unindexed-query diagnostics via schema.prisma discovery"
```

---

### Task 8: Docs, changelog, example, full-suite verification

**Files:**
- Modify: `README.md` (Rules section, Status paragraph, Roadmap)
- Modify: `CHANGELOG.md`
- Modify: `examples/anti-patterns.ts` (append an unindexed example, if the file's structure allows a self-contained snippet)

- [ ] **Step 1: README.** In the Rules section (after `excessive-joins`), add:

```markdown
### unindexed-query
A query filtering or sorting on a column no index covers — the database scans
(or sorts) the whole table. Cardinal reads the indexes straight from your
**`schema.prisma`** (`@id`, `@unique`, `@@index`, `@@unique`, compound leading
columns), discovered automatically like the knowledge file. Override with
`--schema <path>`, disable with `--no-schema`. A knowledge file marking the
table small silences it. **warning** (Prisma today; more ORMs next).
```

  Update the Status paragraph's rule list to include `unindexed-query` ("seven rules"), and move "schema-aware checks" in the Roadmap from *next* to *shipped* (reword: "Shipped: … **schema-awareness for Prisma** (`unindexed-query` reads indexes from schema.prisma) …; Next: index extraction for Drizzle/TypeORM/Mongoose …").

- [ ] **Step 2: CHANGELOG.** Add under a new `## Unreleased` heading at the top (matching the file's existing heading style):

```markdown
## Unreleased

- feat(core): `unindexed-query` rule — flags queries filtering/sorting on
  columns no index covers, using indexes parsed from `schema.prisma`
  (`@id`/`@unique`/`@@index`/`@@unique`, compound leading-column aware).
- feat(cli): auto-discovers `prisma/schema.prisma`; new `--schema <path>` and
  `--no-schema` flags.
- feat(vscode): live `unindexed-query` diagnostics; re-lints when
  `schema.prisma` changes.
```

- [ ] **Step 3: Verify everything from the repo root**

Run: `pnpm test`
Expected: all packages build, full suite passes.

Then a live smoke test — create `/tmp`-free scratch demo inside the scratchpad dir with a `schema.prisma` + a bad query file, run the built CLI against it, and confirm the new diagnostic prints, e.g.:

```
app.ts:2:10  warning  unindexed-query  Query on "user" filters on "name", but no index has it as its leading column — the database scans the whole table. Add `@@index([name])` in schema.prisma.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md examples/anti-patterns.ts
git commit -m "docs: unindexed-query rule + schema-awareness (schema.prisma)"
```

---

## Self-Review Notes

- **Spec coverage:** parse Prisma schema (Task 1), discovery (Task 2), orderBy extraction (Task 3), the rule with filter + sort + compound-index + knowledge interplay (Task 4), engine (Task 5), CLI (Task 6), editor (Task 7), docs + demo (Task 8). The "show info: this query's column has no index so it will be slow" ask is the diagnostic message wording in Task 4 and the smoke test in Task 8.
- **Type consistency:** `SchemaInfo.orm` matches `QueryDescriptor.orm` (`"prisma"`); `analyzeSource` 5th param name `schema` used identically in engine, CLI `run.ts`, and vscode `analyze.ts`; `ModelSchema.indexes: string[][]` consumed by the rule via `ix[0]`/`ix.slice(1)`.
- **Known scope cuts (deliberate, YAGNI):** no Drizzle/TypeORM/Mongoose index extraction yet (SchemaInfo.orm field keeps the door open); no `@@map` handling (client calls use model names, not table names); write/delete operations excluded from the rule in v1 for precision.
