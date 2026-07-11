# Business-Logic Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make QueryGuard's rules data-aware by reading a user-authored, static knowledge file (table cardinalities + filter selectivity), so it silences provably-small loops, escalates provably-large fan-out, suggests narrower reads, and lets users suppress any diagnostic (with an optional reason that can seed a knowledge fact).

**Architecture:** A new `knowledge/` module in `@queryguard/core` loads a `queryguard.knowledge.yaml` file into a normalized `Knowledge` object. The Prisma adapter extracts `where` predicates onto each `QueryDescriptor`. Two pure functions — `estimateCardinality` (query → row bound) and `resolveDrivingSet` (loop → driving-collection bound, conservative) — feed a `bound` into an enriched `RuleContext`. Rules react to the bound. A suppression list in the same file (matched by rule + file + function + normalized call anchor, never raw line) is honored by the engine and written by an interactive `queryguard suppress` command. With no knowledge file, output is byte-identical to today.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), ts-morph, vitest, tsup, pnpm workspaces, the `yaml` package (new dependency in `@queryguard/core`).

## Global Constraints

- Node.js **>= 18**; ESM only (`"type": "module"`), all relative imports end in `.js`.
- **100% static:** no network, no LLM, no DB connection anywhere in the analysis path. The `yaml` package is a pure-JS, offline parse/stringify dependency — acceptable.
- **Identity guarantee:** with no knowledge file, no inline hints, and no suppressions, `analyzeSource` output is byte-identical to today. Every new `RuleContext` field is **optional**; rules default to `unknown` when it is absent.
- **Precision-first:** never silence a real N+1 on a guess. Auto-suppression only on an unambiguous trace; auto-promotion of a reason to a general fact never happens without explicit confirm.
- Default thresholds: `small = 50`, `large = 1000`.
- Tests: vitest, `describe/it/expect`, import source via `../src/*.js`. Run per-package with `pnpm --filter @queryguard/core test` (or `@queryguard/cli`). Build all with `pnpm build`.
- Commit after every task (frequent commits). Conventional-commit style, matching the repo.

---

### Task 1: Knowledge types, loader, and discovery

**Files:**
- Create: `packages/core/src/knowledge/types.ts`
- Create: `packages/core/src/knowledge/load.ts`
- Test: `packages/core/test/knowledge/load.test.ts`
- Modify: `packages/core/package.json` (add `yaml` dependency)
- Modify: `packages/core/src/index.ts` (export the new module)

**Interfaces:**
- Produces:
  - `type Bound = "small" | "medium" | "large" | "unknown"`
  - `interface Cardinality { count?: number; bound: Bound; source: "filter" | "table" | "none" }`
  - `interface FilterFact { when: Record<string, string | number | boolean>; rows: number }`
  - `interface TableFact { rows?: number; filters?: FilterFact[] }`
  - `interface Thresholds { small: number; large: number }`
  - `interface Suppression { rule: string; file: string; fn: string; anchor: string; reason?: string; added?: string }`
  - `interface Knowledge { version: 1; tables: Record<string, TableFact>; thresholds: Thresholds; suppressions: Suppression[]; baseDir: string }`
  - `const DEFAULT_THRESHOLDS: Thresholds`
  - `function parseKnowledge(text: string, baseDir: string): Knowledge | null`
  - `function loadKnowledge(filePath: string): Knowledge | null`
  - `function discoverKnowledge(fromDir: string): Knowledge | null`

- [ ] **Step 1: Add the `yaml` dependency**

Run: `pnpm --filter @queryguard/core add yaml`
Expected: `packages/core/package.json` gains `"yaml": "^2.x"` under `dependencies`; lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `packages/core/test/knowledge/load.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseKnowledge, DEFAULT_THRESHOLDS } from "../../src/knowledge/load.js";

describe("parseKnowledge", () => {
  it("parses tables, filters, and applies default thresholds", () => {
    const k = parseKnowledge(
      `version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
`,
      "/proj",
    )!;
    expect(k).not.toBeNull();
    expect(k.tables.user.rows).toBe(10000);
    expect(k.tables.user.filters?.[0]).toEqual({ when: { status: "active" }, rows: 10 });
    expect(k.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(k.suppressions).toEqual([]);
    expect(k.baseDir).toBe("/proj");
  });

  it("honors explicit thresholds and suppressions", () => {
    const k = parseKnowledge(
      `version: 1
tables: {}
thresholds: { small: 5, large: 500 }
suppressions:
  - rule: n-plus-one
    file: src/x.ts
    fn: run
    anchor: "db.q()"
`,
      "/proj",
    )!;
    expect(k.thresholds).toEqual({ small: 5, large: 500 });
    expect(k.suppressions).toHaveLength(1);
    expect(k.suppressions[0].rule).toBe("n-plus-one");
  });

  it("returns null on wrong version or malformed yaml", () => {
    expect(parseKnowledge(`version: 2\ntables: {}`, "/p")).toBeNull();
    expect(parseKnowledge(`: : :`, "/p")).toBeNull();
    expect(parseKnowledge(`version: 1`, "/p")).toBeNull(); // missing tables
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/load.test.ts`
Expected: FAIL — cannot find `../../src/knowledge/load.js`.

- [ ] **Step 4: Write `types.ts`**

Create `packages/core/src/knowledge/types.ts`:

```ts
export type Bound = "small" | "medium" | "large" | "unknown";

export interface Cardinality {
  count?: number;
  bound: Bound;
  source: "filter" | "table" | "none";
}

export interface FilterFact {
  when: Record<string, string | number | boolean>;
  rows: number;
}

export interface TableFact {
  rows?: number;
  filters?: FilterFact[];
}

export interface Thresholds {
  small: number;
  large: number;
}

export interface Suppression {
  rule: string;
  file: string;
  fn: string;
  anchor: string;
  reason?: string;
  added?: string;
}

export interface Knowledge {
  version: 1;
  tables: Record<string, TableFact>;
  thresholds: Thresholds;
  suppressions: Suppression[];
  /** Absolute directory the knowledge file lives in — used to resolve suppression file paths. */
  baseDir: string;
}
```

- [ ] **Step 5: Write `load.ts`**

Create `packages/core/src/knowledge/load.ts`:

```ts
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Knowledge, Thresholds } from "./types.js";

export * from "./types.js";

export const DEFAULT_THRESHOLDS: Thresholds = { small: 50, large: 1000 };

const FILE_NAMES = ["queryguard.knowledge.yaml", "queryguard.knowledge.yml", "queryguard.knowledge.json"];

export function parseKnowledge(text: string, baseDir: string): Knowledge | null {
  let raw: unknown;
  try {
    raw = parseYaml(text); // yaml.parse also accepts JSON
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return null;
  if (typeof obj.tables !== "object" || obj.tables === null) return null;

  const th = (obj.thresholds ?? {}) as Partial<Thresholds>;
  const thresholds: Thresholds = {
    small: typeof th.small === "number" ? th.small : DEFAULT_THRESHOLDS.small,
    large: typeof th.large === "number" ? th.large : DEFAULT_THRESHOLDS.large,
  };

  const suppressions = Array.isArray(obj.suppressions)
    ? (obj.suppressions as Knowledge["suppressions"])
    : [];

  return {
    version: 1,
    tables: obj.tables as Knowledge["tables"],
    thresholds,
    suppressions,
    baseDir,
  };
}

export function loadKnowledge(filePath: string): Knowledge | null {
  if (!existsSync(filePath)) return null;
  try {
    return parseKnowledge(readFileSync(filePath, "utf8"), dirname(filePath));
  } catch {
    return null;
  }
}

export function discoverKnowledge(fromDir: string): Knowledge | null {
  let dir = fromDir;
  // Walk up to filesystem root.
  while (true) {
    for (const name of FILE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return loadKnowledge(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir || parsePath(dir).root === dir) return null;
    dir = parent;
  }
}
```

- [ ] **Step 6: Export from index**

Modify `packages/core/src/index.ts` — add after the existing exports:

```ts
export * from "./knowledge/load.js";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/load.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/knowledge/types.ts packages/core/src/knowledge/load.ts \
  packages/core/test/knowledge/load.test.ts packages/core/src/index.ts \
  packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): knowledge file types, loader, and upward discovery"
```

---

### Task 2: Filter-predicate extraction in the Prisma adapter

**Files:**
- Modify: `packages/core/src/types.ts` (add `QueryFilter`, `filters?` on `QueryDescriptor`)
- Modify: `packages/core/src/adapters/prisma.ts` (extract predicates)
- Test: `packages/core/test/adapters/prisma.test.ts` (append cases)

**Interfaces:**
- Consumes: `QueryDescriptor` (Task-independent, existing).
- Produces:
  - `interface QueryFilter { field: string; value?: string | number | boolean; kind: "eq" | "in" | "other" }`
  - `QueryDescriptor.filters?: QueryFilter[]`

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/adapters/prisma.test.ts` inside the `describe("prismaAdapter", ...)` block:

```ts
  it("extracts equality where-predicates into filters", () => {
    const call = firstCall(
      `async function r(prisma){ await prisma.user.findMany({ where: { status: "active", orgId: 3 } }); }`,
      "prisma.user.findMany",
    );
    const d = prismaAdapter(call)!;
    expect(d.filters).toEqual([
      { field: "status", value: "active", kind: "eq" },
      { field: "orgId", value: 3, kind: "eq" },
    ]);
  });

  it("classifies an { in: [...] } predicate as kind 'in' and nested objects as 'other'", () => {
    const call = firstCall(
      `async function r(prisma){ await prisma.user.findMany({ where: { id: { in: [1,2] }, profile: { age: 5 } } }); }`,
      "prisma.user.findMany",
    );
    const d = prismaAdapter(call)!;
    expect(d.filters).toEqual([
      { field: "id", kind: "in" },
      { field: "profile", kind: "other" },
    ]);
  });

  it("leaves filters empty when there is no where", () => {
    const call = firstCall(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
    expect(prismaAdapter(call)!.filters).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/adapters/prisma.test.ts`
Expected: FAIL — `d.filters` is `undefined`.

- [ ] **Step 3: Add the type** — modify `packages/core/src/types.ts`, add above `QueryDescriptor`:

```ts
export interface QueryFilter {
  field: string;
  value?: string | number | boolean;
  kind: "eq" | "in" | "other";
}
```

and add to the `QueryDescriptor` interface (after `selectedFields?`):

```ts
  filters?: QueryFilter[];
```

- [ ] **Step 4: Extract predicates in the adapter** — modify `packages/core/src/adapters/prisma.ts`.

Import `QueryFilter`:

```ts
import type { QueryDescriptor, QueryFilter } from "../types.js";
```

Add this helper above `readOptions`:

```ts
function extractFilters(whereInit: unknown): QueryFilter[] {
  const node = whereInit;
  if (!node || !Node.isObjectLiteralExpression(node as Node)) return [];
  return (node as import("ts-morph").ObjectLiteralExpression)
    .getProperties()
    .filter(Node.isPropertyAssignment)
    .map((p): QueryFilter => {
      const field = p.getName();
      const init = p.getInitializer();
      if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
        return { field, value: init.getLiteralValue(), kind: "eq" };
      }
      if (init && Node.isNumericLiteral(init)) {
        return { field, value: init.getLiteralValue(), kind: "eq" };
      }
      if (init && (init.getKind() === SyntaxKind.TrueKeyword || init.getKind() === SyntaxKind.FalseKeyword)) {
        return { field, value: init.getText() === "true", kind: "eq" };
      }
      if (init && Node.isObjectLiteralExpression(init) && init.getProperty("in")) {
        return { field, kind: "in" };
      }
      return { field, kind: "other" };
    });
}
```

Add the `SyntaxKind` import at the top:

```ts
import { Node, SyntaxKind } from "ts-morph";
```

In `readOptions`, capture the `where` initializer and return it. Change the return type and body:

```ts
function readOptions(call: CallExpression): {
  hasLimit: boolean;
  hasFilter: boolean;
  selectedFields: string[];
  filters: QueryFilter[];
} {
  const [firstArg] = call.getArguments();
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) {
    return { hasLimit: false, hasFilter: false, selectedFields: [], filters: [] };
  }
  const hasProp = (name: string) => Boolean(firstArg.getProperty(name));
  const selectProp = firstArg.getProperty("select");
  let selectedFields: string[] = [];
  if (selectProp && Node.isPropertyAssignment(selectProp)) {
    const init = selectProp.getInitializer();
    if (init && Node.isObjectLiteralExpression(init)) {
      selectedFields = init
        .getProperties()
        .filter(Node.isPropertyAssignment)
        .map((p) => p.getName());
    }
  }
  const whereProp = firstArg.getProperty("where");
  const whereInit =
    whereProp && Node.isPropertyAssignment(whereProp) ? whereProp.getInitializer() : undefined;
  return {
    hasLimit: hasProp("take"),
    hasFilter: hasProp("where"),
    selectedFields,
    filters: extractFilters(whereInit),
  };
}
```

In the returned descriptor object, add:

```ts
    filters: options.filters,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @queryguard/core exec vitest run test/adapters/prisma.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/adapters/prisma.ts packages/core/test/adapters/prisma.test.ts
git commit -m "feat(core): extract where-predicates into QueryDescriptor.filters"
```

---

### Task 3: Cardinality estimator

**Files:**
- Create: `packages/core/src/knowledge/cardinality.ts`
- Test: `packages/core/test/knowledge/cardinality.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `QueryDescriptor` (with `filters`, `hasFilter`), `Knowledge`, `Thresholds`, `Cardinality`, `Bound`.
- Produces:
  - `function bucket(count: number, t: Thresholds): Bound`
  - `function estimateCardinality(d: QueryDescriptor, k: Knowledge | null | undefined): Cardinality`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/knowledge/cardinality.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import { estimateCardinality, bucket } from "../../src/knowledge/cardinality.js";
import type { QueryDescriptor } from "../../src/types.js";

function descriptor(code: string, callee: string): QueryDescriptor {
  const sf = parseSource(code);
  const call = findCallExpressions(sf).find((c) => c.getExpression().getText() === callee)!;
  return prismaAdapter(call)!;
}

const knowledge = parseKnowledge(
  `version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
`,
  "/p",
);

describe("bucket", () => {
  it("buckets by thresholds inclusively at the edges", () => {
    const t = { small: 50, large: 1000 };
    expect(bucket(50, t)).toBe("small");
    expect(bucket(51, t)).toBe("medium");
    expect(bucket(999, t)).toBe("medium");
    expect(bucket(1000, t)).toBe("large");
  });
});

describe("estimateCardinality", () => {
  it("uses a matching filter fact (superset match) for a small bound", () => {
    const d = descriptor(`async function r(prisma){ await prisma.user.findMany({ where: { status: "active", orgId: 1 } }); }`, "prisma.user.findMany");
    expect(estimateCardinality(d, knowledge)).toEqual({ count: 10, bound: "small", source: "filter" });
  });

  it("falls back to table rows for an unfiltered read (large)", () => {
    const d = descriptor(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
    expect(estimateCardinality(d, knowledge)).toEqual({ count: 10000, bound: "large", source: "table" });
  });

  it("returns unknown when filtered but no fact matches", () => {
    const d = descriptor(`async function r(prisma){ await prisma.user.findMany({ where: { orgId: 1 } }); }`, "prisma.user.findMany");
    expect(estimateCardinality(d, knowledge).bound).toBe("unknown");
  });

  it("returns unknown with no knowledge or unknown table", () => {
    const d = descriptor(`async function r(prisma){ await prisma.post.findMany(); }`, "prisma.post.findMany");
    expect(estimateCardinality(d, null).bound).toBe("unknown");
    expect(estimateCardinality(d, knowledge).bound).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/cardinality.test.ts`
Expected: FAIL — cannot find `cardinality.js`.

- [ ] **Step 3: Implement**

Create `packages/core/src/knowledge/cardinality.ts`:

```ts
import type { QueryDescriptor } from "../types.js";
import type { Bound, Cardinality, Knowledge, Thresholds } from "./types.js";

export function bucket(count: number, t: Thresholds): Bound {
  if (count <= t.small) return "small";
  if (count >= t.large) return "large";
  return "medium";
}

export function estimateCardinality(
  d: QueryDescriptor,
  k: Knowledge | null | undefined,
): Cardinality {
  if (!k) return { bound: "unknown", source: "none" };
  const table = k.tables[d.target];
  if (!table) return { bound: "unknown", source: "none" };

  // eq predicates the query actually applies, as field -> value.
  const eq = new Map<string, string | number | boolean>();
  for (const f of d.filters ?? []) {
    if (f.kind === "eq" && f.value !== undefined) eq.set(f.field, f.value);
  }

  // Matching filter facts: every `when` key present in the query's eq predicates
  // with an equal value (query filters are a superset of `when`). Pick the tightest.
  let best: number | undefined;
  for (const fact of table.filters ?? []) {
    const matches = Object.entries(fact.when).every(([key, val]) => eq.get(key) === val);
    if (matches && (best === undefined || fact.rows < best)) best = fact.rows;
  }
  if (best !== undefined) {
    return { count: best, bound: bucket(best, k.thresholds), source: "filter" };
  }

  if (d.hasFilter === false && typeof table.rows === "number") {
    return { count: table.rows, bound: bucket(table.rows, k.thresholds), source: "table" };
  }

  return { bound: "unknown", source: "none" };
}
```

- [ ] **Step 4: Export from index** — add to `packages/core/src/index.ts`:

```ts
export * from "./knowledge/cardinality.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/cardinality.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/knowledge/cardinality.ts packages/core/test/knowledge/cardinality.test.ts packages/core/src/index.ts
git commit -m "feat(core): estimateCardinality maps a query to a row-count bound"
```

---

### Task 4: Conservative driving-set linker

**Files:**
- Create: `packages/core/src/knowledge/driving-set.ts`
- Test: `packages/core/test/knowledge/driving-set.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `QueryDescriptor`, `Knowledge`, `estimateCardinality`, ts-morph `Node`.
- Produces:
  - `function resolveDrivingSet(loopDescriptor: QueryDescriptor, descriptors: QueryDescriptor[], k: Knowledge | null | undefined): Cardinality`

Only resolves the unambiguous case: the loop's iterated collection is a bare identifier, declared exactly once in the same function, never reassigned, initialized by a single known query call. Anything else → `{ bound: "unknown", source: "none" }`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/knowledge/driving-set.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import { resolveDrivingSet } from "../../src/knowledge/driving-set.js";
import type { QueryDescriptor } from "../../src/types.js";

const knowledge = parseKnowledge(
  `version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
`,
  "/p",
);

function build(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => prismaAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}
function loopOne(ds: QueryDescriptor[]): QueryDescriptor {
  return ds.find((d) => d.inLoop)!;
}

describe("resolveDrivingSet", () => {
  it("traces a small driving set (filtered producer in same function)", () => {
    const ds = build(`
      async function r(prisma){
        const active = await prisma.user.findMany({ where: { status: "active" } });
        for (const u of active) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge)).toEqual({ count: 10, bound: "small", source: "filter" });
  });

  it("traces a large driving set (unfiltered producer)", () => {
    const ds = build(`
      async function r(prisma){
        const all = await prisma.user.findMany();
        for (const u of all) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge).bound).toBe("large");
  });

  it("is unknown when the collection is reassigned", () => {
    const ds = build(`
      async function r(prisma, other){
        let active = await prisma.user.findMany({ where: { status: "active" } });
        active = other;
        for (const u of active) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge).bound).toBe("unknown");
  });

  it("is unknown when the collection is not a plain identifier", () => {
    const ds = build(`
      async function r(prisma){
        for (const u of (await prisma.user.findMany({ where: { status: "active" } }))) {
          await prisma.post.findMany({ where: { authorId: u.id } });
        }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge).bound).toBe("unknown");
  });

  it("is unknown when the producer is not a known query", () => {
    const ds = build(`
      async function r(prisma, fetchUsers){
        const active = await fetchUsers();
        for (const u of active) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge).bound).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/driving-set.test.ts`
Expected: FAIL — cannot find `driving-set.js`.

- [ ] **Step 3: Implement**

Create `packages/core/src/knowledge/driving-set.ts`:

```ts
import { Node, SyntaxKind } from "ts-morph";
import type { Node as TsNode, FunctionDeclaration } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import type { Cardinality, Knowledge } from "./types.js";
import { estimateCardinality } from "./cardinality.js";

const UNKNOWN: Cardinality = { bound: "unknown", source: "none" };
const ITERATION_METHODS = new Set(["map", "forEach", "flatMap"]);
const FUNCTION_KINDS = (a: TsNode) =>
  Node.isFunctionDeclaration(a) ||
  Node.isFunctionExpression(a) ||
  Node.isArrowFunction(a) ||
  Node.isMethodDeclaration(a);

/** The identifier naming the collection this loop iterates, or null. */
function iteratedIdentifier(queryNode: TsNode): TsNode | null {
  const forOf = queryNode.getFirstAncestorByKind(SyntaxKind.ForOfStatement);
  if (forOf) {
    const expr = forOf.getExpression();
    return Node.isIdentifier(expr) ? expr : null;
  }
  const iterCall = queryNode.getFirstAncestor((a) => {
    if (!Node.isCallExpression(a)) return false;
    const e = a.getExpression();
    return Node.isPropertyAccessExpression(e) && ITERATION_METHODS.has(e.getName());
  });
  if (iterCall && Node.isCallExpression(iterCall)) {
    const e = iterCall.getExpression();
    if (Node.isPropertyAccessExpression(e)) {
      const receiver = e.getExpression();
      return Node.isIdentifier(receiver) ? receiver : null;
    }
  }
  return null;
}

function isReassigned(fn: TsNode, name: string): boolean {
  return fn.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => {
    if (id.getText() !== name) return false;
    const p = id.getParent();
    if (Node.isBinaryExpression(p) && p.getOperatorToken().getText() === "=" && p.getLeft() === id) return true;
    if (Node.isPostfixUnaryExpression(p) || Node.isPrefixUnaryExpression(p)) return true;
    return false;
  });
}

export function resolveDrivingSet(
  loopDescriptor: QueryDescriptor,
  descriptors: QueryDescriptor[],
  k: Knowledge | null | undefined,
): Cardinality {
  if (!k) return UNKNOWN;
  const ident = iteratedIdentifier(loopDescriptor.node);
  if (!ident) return UNKNOWN;
  const name = ident.getText();

  const fn = loopDescriptor.node.getFirstAncestor(FUNCTION_KINDS) as FunctionDeclaration | undefined;
  if (!fn) return UNKNOWN;
  if (isReassigned(fn, name)) return UNKNOWN;

  const decls = fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((d) => d.getName() === name);
  if (decls.length !== 1) return UNKNOWN;

  let init = decls[0].getInitializer();
  if (init && Node.isAwaitExpression(init)) init = init.getExpression();
  if (!init || !Node.isCallExpression(init)) return UNKNOWN;

  const producer = descriptors.find((d) => d.node.getStart() === init!.getStart());
  if (!producer) return UNKNOWN;

  return estimateCardinality(producer, k);
}
```

- [ ] **Step 4: Export from index** — add to `packages/core/src/index.ts`:

```ts
export * from "./knowledge/driving-set.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/driving-set.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/knowledge/driving-set.ts packages/core/test/knowledge/driving-set.test.ts packages/core/src/index.ts
git commit -m "feat(core): conservative driving-set linker for loop cardinality"
```

---

### Task 5: Inline hint reader

**Files:**
- Create: `packages/core/src/knowledge/hints.ts`
- Test: `packages/core/test/knowledge/hints.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: ts-morph `Node` (a query descriptor's `.node`).
- Produces:
  - `type InlineHint = { kind: "bounded" | "unbounded"; count?: number }`
  - `function readInlineHint(queryNode: import("ts-morph").Node): InlineHint | null`

A hint is a `// queryguard: bounded [n]` or `// queryguard: unbounded` comment leading the enclosing loop statement (or the `.map`/`.forEach`/`.flatMap` call).

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/knowledge/hints.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { readInlineHint } from "../../src/knowledge/hints.js";

function queryNode(code: string, callee: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === callee)!;
}

describe("readInlineHint", () => {
  it("reads 'bounded' with an optional count above a for-of loop", () => {
    const n = queryNode(
      `async function r(prisma, xs){
        // queryguard: bounded 10
        for (const x of xs) { await prisma.post.findMany({ where: { authorId: x.id } }); }
      }`,
      "prisma.post.findMany",
    );
    expect(readInlineHint(n)).toEqual({ kind: "bounded", count: 10 });
  });

  it("reads 'unbounded' above a .map iteration", () => {
    const n = queryNode(
      `async function r(prisma, xs){
        // queryguard: unbounded
        await Promise.all(xs.map(async (x) => prisma.post.findMany({ where: { authorId: x.id } })));
      }`,
      "prisma.post.findMany",
    );
    expect(readInlineHint(n)).toEqual({ kind: "unbounded" });
  });

  it("returns null with no hint", () => {
    const n = queryNode(
      `async function r(prisma, xs){ for (const x of xs) { await prisma.post.findMany({ where: { authorId: x.id } }); } }`,
      "prisma.post.findMany",
    );
    expect(readInlineHint(n)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/hints.test.ts`
Expected: FAIL — cannot find `hints.js`.

- [ ] **Step 3: Implement**

Create `packages/core/src/knowledge/hints.ts`:

```ts
import { Node, SyntaxKind } from "ts-morph";
import type { Node as TsNode } from "ts-morph";

export type InlineHint = { kind: "bounded" | "unbounded"; count?: number };

const ITERATION_METHODS = new Set(["map", "forEach", "flatMap"]);
const HINT_RE = /queryguard:\s*(bounded|unbounded)(?:\s+(\d+))?/;

/** The statement/expression whose leading comment carries the loop hint. */
function loopCarrier(queryNode: TsNode): TsNode | null {
  const loop = queryNode.getFirstAncestor(
    (a) =>
      Node.isForStatement(a) ||
      Node.isForOfStatement(a) ||
      Node.isForInStatement(a) ||
      Node.isWhileStatement(a) ||
      Node.isDoStatement(a),
  );
  if (loop) return loop;
  const iterCall = queryNode.getFirstAncestor((a) => {
    if (!Node.isCallExpression(a)) return false;
    const e = a.getExpression();
    return Node.isPropertyAccessExpression(e) && ITERATION_METHODS.has(e.getName());
  });
  // For a .map(...) call, the hint sits above the enclosing statement.
  return iterCall ? iterCall.getFirstAncestorByKind(SyntaxKind.ExpressionStatement) ?? iterCall : null;
}

export function readInlineHint(queryNode: TsNode): InlineHint | null {
  const carrier = loopCarrier(queryNode);
  if (!carrier) return null;
  for (const range of carrier.getLeadingCommentRanges()) {
    const m = HINT_RE.exec(range.getText());
    if (m) {
      const kind = m[1] as "bounded" | "unbounded";
      return kind === "bounded" && m[2] ? { kind, count: Number(m[2]) } : { kind };
    }
  }
  return null;
}
```

- [ ] **Step 4: Export from index** — add to `packages/core/src/index.ts`:

```ts
export * from "./knowledge/hints.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/hints.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/knowledge/hints.ts packages/core/test/knowledge/hints.test.ts packages/core/src/index.ts
git commit -m "feat(core): inline bounded/unbounded hint reader"
```

---

### Task 6: Enrich RuleContext and wire the engine

**Files:**
- Modify: `packages/core/src/types.ts` (extend `RuleContext`)
- Modify: `packages/core/src/engine.ts` (compute maps, thread knowledge, register over-fetch stub import later)
- Test: `packages/core/test/engine.test.ts` (append)

**Interfaces:**
- Consumes: `estimateCardinality`, `resolveDrivingSet`, `readInlineHint`, `Knowledge`, `Cardinality`.
- Produces (extended `RuleContext`, all new fields **optional** for back-compat):
  - `RuleContext.knowledge?: Knowledge | null`
  - `RuleContext.cardinalityOf?: (d: QueryDescriptor) => Cardinality`
  - `RuleContext.loopBoundOf?: (d: QueryDescriptor) => Cardinality`
  - `function analyzeSource(code: string, filePath?: string, knowledge?: Knowledge | null): Diagnostic[]`

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/engine.test.ts`:

```ts
import { parseKnowledge } from "../src/knowledge/load.js";

describe("analyzeSource with knowledge", () => {
  const knowledge = parseKnowledge(
    `version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
`,
    "/p",
  );

  it("suppresses n-plus-one when the driving set is provably small", () => {
    const diags = analyzeSource(
      `async function r(prisma){
        const active = await prisma.user.findMany({ where: { status: "active" } });
        for (const u of active) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }`,
      undefined,
      knowledge,
    );
    expect(diags.filter((d) => d.ruleId === "n-plus-one")).toHaveLength(0);
  });

  it("honors an inline bounded hint even without a traceable producer", () => {
    const diags = analyzeSource(
      `async function r(prisma, xs){
        // queryguard: bounded
        for (const x of xs) { await prisma.post.findMany({ where: { authorId: x.id } }); }
      }`,
      undefined,
      knowledge,
    );
    expect(diags.filter((d) => d.ruleId === "n-plus-one")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/engine.test.ts`
Expected: FAIL — n-plus-one still fires (not yet reacting to bounds).

- [ ] **Step 3: Extend `RuleContext`** — modify `packages/core/src/types.ts`.

Add imports at top (keep existing `Node` import):

```ts
import type { Cardinality, Knowledge } from "./knowledge/types.js";
```

Replace the `RuleContext` interface with:

```ts
export interface RuleContext {
  descriptors: QueryDescriptor[];
  knowledge?: Knowledge | null;
  cardinalityOf?: (d: QueryDescriptor) => Cardinality;
  loopBoundOf?: (d: QueryDescriptor) => Cardinality;
}
```

- [ ] **Step 4: Wire the engine** — modify `packages/core/src/engine.ts`.

Add imports:

```ts
import { estimateCardinality } from "./knowledge/cardinality.js";
import { resolveDrivingSet } from "./knowledge/driving-set.js";
import { readInlineHint } from "./knowledge/hints.js";
import type { Knowledge, Cardinality } from "./knowledge/types.js";
```

Change the signature and body of `analyzeSource`:

```ts
export function analyzeSource(
  code: string,
  filePath?: string,
  knowledge?: Knowledge | null,
): Diagnostic[] {
  const sf = parseSource(code, filePath);
  const calls = findCallExpressions(sf);

  const descriptors: QueryDescriptor[] = [];
  for (const call of calls) {
    for (const adapter of adapters) {
      const descriptor = adapter(call);
      if (descriptor) {
        descriptors.push(descriptor);
        break;
      }
    }
  }

  const cardCache = new Map<QueryDescriptor, Cardinality>();
  const cardinalityOf = (d: QueryDescriptor): Cardinality => {
    let c = cardCache.get(d);
    if (!c) {
      c = estimateCardinality(d, knowledge);
      cardCache.set(d, c);
    }
    return c;
  };

  const loopCache = new Map<QueryDescriptor, Cardinality>();
  const loopBoundOf = (d: QueryDescriptor): Cardinality => {
    let c = loopCache.get(d);
    if (c) return c;
    if (!d.inLoop) {
      c = { bound: "unknown", source: "none" };
    } else {
      const hint = readInlineHint(d.node);
      if (hint?.kind === "bounded") c = { count: hint.count, bound: "small", source: "none" };
      else if (hint?.kind === "unbounded") c = { bound: "large", source: "none" };
      else c = resolveDrivingSet(d, descriptors, knowledge);
    }
    loopCache.set(d, c);
    return c;
  };

  const ctx = { descriptors, knowledge, cardinalityOf, loopBoundOf };

  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    try {
      diagnostics.push(...rule.match(ctx));
    } catch {
      // Best-effort: a throwing rule is skipped, never fatal.
    }
  }
  return diagnostics;
}
```

- [ ] **Step 5: Run test to verify it fails differently**

Run: `pnpm --filter @queryguard/core exec vitest run test/engine.test.ts`
Expected: still FAIL on the two new tests — the context is wired but `n-plus-one` does not yet consult `loopBoundOf`. (Task 7 fixes this.) Existing engine tests PASS.

- [ ] **Step 6: Commit the wiring**

```bash
git add packages/core/src/types.ts packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): enrich RuleContext with cardinality/loop-bound and thread knowledge"
```

---

### Task 7: n-plus-one reacts to loop cardinality

**Files:**
- Modify: `packages/core/src/rules/n-plus-one.ts`
- Test: `packages/core/test/rules/n-plus-one.test.ts` (append)

**Interfaces:**
- Consumes: `RuleContext.loopBoundOf` (optional; default `unknown`).
- Produces: unchanged rule id/signature; behavior varies by bound.

- [ ] **Step 1: Write the failing test** — append inside `describe("nPlusOneRule", ...)`:

```ts
  it("suppresses when loopBoundOf reports small", () => {
    const ctx = {
      descriptors: descriptors(`async function r(prisma, ids){ for (const id of ids){ await prisma.user.findUnique({ where: { id } }); } }`),
      loopBoundOf: () => ({ count: 10, bound: "small" as const, source: "none" as const }),
    };
    expect(nPlusOneRule.match(ctx)).toHaveLength(0);
  });

  it("escalates the message with the count when loopBoundOf reports large", () => {
    const ctx = {
      descriptors: descriptors(`async function r(prisma, ids){ for (const id of ids){ await prisma.user.findUnique({ where: { id } }); } }`),
      loopBoundOf: () => ({ count: 10000, bound: "large" as const, source: "table" as const }),
    };
    const diags = nPlusOneRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("10000");
  });

  it("keeps today's behavior when loopBoundOf is absent", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma, ids){ for (const id of ids){ await prisma.user.findUnique({ where: { id } }); } }`) };
    expect(nPlusOneRule.match(ctx)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/rules/n-plus-one.test.ts`
Expected: FAIL — small case still emits, large case lacks the count.

- [ ] **Step 3: Implement** — replace `packages/core/src/rules/n-plus-one.ts`:

```ts
import type { Rule, Cardinality, QueryDescriptor } from "../types.js";
import { makeDiagnostic } from "../types.js";

const UNKNOWN: Cardinality = { bound: "unknown", source: "none" };

export const nPlusOneRule: Rule = {
  id: "n-plus-one",
  defaultSeverity: "error",
  match(ctx) {
    const loopBoundOf = ctx.loopBoundOf ?? (() => UNKNOWN);
    return ctx.descriptors
      .filter((d: QueryDescriptor) => d.inLoop)
      .flatMap((d: QueryDescriptor) => {
        const { bound, count } = loopBoundOf(d);
        if (bound === "small") return []; // provably bounded — suppress

        if (bound === "large") {
          const amount = count ? `~${count}` : "a large";
          return [
            makeDiagnostic({
              ruleId: "n-plus-one",
              severity: "error",
              message: `Query on "${d.target}" runs once per row of ${amount}-row set (N+1 amplified). Batch it into a single query (e.g. a WHERE ... IN / findMany).`,
              node: d.node,
              docsUrl: "https://queryguard.dev/rules/n-plus-one",
            }),
          ];
        }

        const severity = d.confidence === "high" ? "error" : "warning";
        const message =
          d.confidence === "high"
            ? `Query on "${d.target}" runs inside a loop (N+1). Batch it into a single query (e.g. a WHERE ... IN / findMany).`
            : `Possible N+1: "${d.target}" looks like a query called inside a loop. If it hits the database, batch it into a single query.`;
        return [
          makeDiagnostic({
            ruleId: "n-plus-one",
            severity,
            message,
            node: d.node,
            docsUrl: "https://queryguard.dev/rules/n-plus-one",
          }),
        ];
      });
  },
};
```

Note: this imports `Cardinality` and `QueryDescriptor` from `../types.js`. Ensure `types.ts` re-exports `Cardinality` — add to `packages/core/src/types.ts`:

```ts
export type { Cardinality, Bound, Knowledge } from "./knowledge/types.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @queryguard/core exec vitest run test/rules/n-plus-one.test.ts test/engine.test.ts`
Expected: PASS — including the two engine tests from Task 6.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rules/n-plus-one.ts packages/core/src/types.ts packages/core/test/rules/n-plus-one.test.ts
git commit -m "feat(core): n-plus-one suppresses small loops and escalates large fan-out"
```

---

### Task 8: over-fetch rule

**Files:**
- Create: `packages/core/src/rules/over-fetch.ts`
- Test: `packages/core/test/rules/over-fetch.test.ts`
- Modify: `packages/core/src/engine.ts` (register rule), `packages/core/src/index.ts` (export)

**Interfaces:**
- Consumes: `RuleContext.knowledge`, `bucket`, `Thresholds`.
- Produces: `const overFetchRule: Rule` with `id: "over-fetch"`, `defaultSeverity: "warning"`.

Fires when: `operation === "read"`, `isAggregate !== true`, `hasFilter === false`, the table's own `rows` buckets to `large`, and the table has at least one filter fact bucketing to `small`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/rules/over-fetch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import { overFetchRule } from "../../src/rules/over-fetch.js";
import type { QueryDescriptor } from "../../src/types.js";

const knowledge = parseKnowledge(
  `version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
  tag:
    rows: 12
`,
  "/p",
);

function descriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf).map((c) => prismaAdapter(c)).filter((d): d is QueryDescriptor => d !== null);
}

describe("overFetchRule", () => {
  it("flags an unfiltered read on a large table that has a small selective filter", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.user.findMany(); }`), knowledge };
    const diags = overFetchRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("over-fetch");
    expect(diags[0].message).toContain("status");
  });

  it("does not flag when a where is present", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.user.findMany({ where: { status: "active" } }); }`), knowledge };
    expect(overFetchRule.match(ctx)).toHaveLength(0);
  });

  it("does not flag a small table (tag: 12) even unfiltered", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.tag.findMany(); }`), knowledge };
    expect(overFetchRule.match(ctx)).toHaveLength(0);
  });

  it("does not flag without knowledge", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.user.findMany(); }`) };
    expect(overFetchRule.match(ctx)).toHaveLength(0);
  });

  it("does not flag aggregates", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.user.count(); }`), knowledge };
    expect(overFetchRule.match(ctx)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/rules/over-fetch.test.ts`
Expected: FAIL — cannot find `over-fetch.js`.

- [ ] **Step 3: Implement**

Create `packages/core/src/rules/over-fetch.ts`:

```ts
import type { Rule, QueryDescriptor } from "../types.js";
import { makeDiagnostic } from "../types.js";
import { bucket } from "../knowledge/cardinality.js";

export const overFetchRule: Rule = {
  id: "over-fetch",
  defaultSeverity: "warning",
  match(ctx) {
    const k = ctx.knowledge;
    if (!k) return [];
    return ctx.descriptors
      .filter(
        (d: QueryDescriptor) =>
          d.operation === "read" && d.isAggregate !== true && d.hasFilter === false,
      )
      .flatMap((d: QueryDescriptor) => {
        const table = k.tables[d.target];
        if (!table || typeof table.rows !== "number") return [];
        if (bucket(table.rows, k.thresholds) !== "large") return [];
        const smallFilter = (table.filters ?? []).find((f) => bucket(f.rows, k.thresholds) === "small");
        if (!smallFilter) return [];
        const pred = Object.entries(smallFilter.when)
          .map(([key, val]) => `${key}=${String(val)}`)
          .join(", ");
        return [
          makeDiagnostic({
            ruleId: "over-fetch",
            severity: "warning",
            message: `Read on "${d.target}" loads all ~${table.rows} rows, but a "${pred}" (~${smallFilter.rows}) subset likely suffices. Add a where, or confirm you need the full table.`,
            node: d.node,
            docsUrl: "https://queryguard.dev/rules/over-fetch",
          }),
        ];
      });
  },
};
```

- [ ] **Step 4: Register + export** — modify `packages/core/src/engine.ts`:

```ts
import { overFetchRule } from "./rules/over-fetch.js";
```

and update the rules array:

```ts
const rules: Rule[] = [nPlusOneRule, unboundedReadRule, overFetchRule];
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./rules/over-fetch.js";
```

- [ ] **Step 5: Run tests to verify pass + no regression**

Run: `pnpm --filter @queryguard/core exec vitest run`
Expected: PASS — all core tests, including the identity engine tests (over-fetch returns `[]` without knowledge).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/rules/over-fetch.ts packages/core/test/rules/over-fetch.test.ts packages/core/src/engine.ts packages/core/src/index.ts
git commit -m "feat(core): over-fetch rule suggests a narrower read from knowledge"
```

---

### Task 9: Suppression anchor + matching + engine filtering

**Files:**
- Create: `packages/core/src/knowledge/suppress.ts`
- Test: `packages/core/test/knowledge/suppress.test.ts`
- Modify: `packages/core/src/engine.ts` (filter suppressed diagnostics before returning), `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `QueryDescriptor`, `Diagnostic`, `Knowledge`, `Suppression`, ts-morph `Node`.
- Produces:
  - `function computeAnchor(node: import("ts-morph").Node): { fn: string; anchor: string }`
  - `function filterSuppressed(diags: Diagnostic[], descriptors: QueryDescriptor[], filePath: string | undefined, k: Knowledge | null | undefined): Diagnostic[]`

Anchor = normalized full call text (whitespace runs collapsed to one space, trimmed). `fn` = nearest named function/method, or the `const`/`let` name an arrow is assigned to, else `<anonymous>`, else `<module>`. Matching requires `rule`, `fn`, `anchor` equal and file **basename** equal (line numbers never used).

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/knowledge/suppress.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { computeAnchor, filterSuppressed } from "../../src/knowledge/suppress.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import type { QueryDescriptor, Diagnostic } from "../../src/types.js";

function descriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf).map((c) => prismaAdapter(c)).filter((d): d is QueryDescriptor => d !== null);
}

describe("computeAnchor", () => {
  it("captures the enclosing function name and normalized call text", () => {
    const d = descriptors(`async function syncContacts(prisma){ await prisma.contact.findMany({ where: { active: true } }); }`)[0];
    const a = computeAnchor(d.node);
    expect(a.fn).toBe("syncContacts");
    expect(a.anchor).toBe('prisma.contact.findMany({ where: { active: true } })');
  });
});

describe("filterSuppressed", () => {
  const code = `async function syncContacts(prisma){ await prisma.contact.findMany({ where: { active: true } }); }`;
  const ds = descriptors(code);
  const diag: Diagnostic = {
    ruleId: "over-fetch",
    severity: "warning",
    message: "x",
    range: { start: ds[0].node.getStart(), end: ds[0].node.getEnd(), line: 1, column: 1 },
  };

  it("drops a diagnostic that matches a suppression", () => {
    const k = parseKnowledge(
      `version: 1
tables: {}
suppressions:
  - rule: over-fetch
    file: src/contacts.ts
    fn: syncContacts
    anchor: "prisma.contact.findMany({ where: { active: true } })"
`,
      "/p",
    );
    expect(filterSuppressed([diag], ds, "/abs/src/contacts.ts", k)).toHaveLength(0);
  });

  it("keeps a diagnostic when rule/fn/anchor differ", () => {
    const k = parseKnowledge(
      `version: 1
tables: {}
suppressions:
  - rule: n-plus-one
    file: src/contacts.ts
    fn: syncContacts
    anchor: "prisma.contact.findMany({ where: { active: true } })"
`,
      "/p",
    );
    expect(filterSuppressed([diag], ds, "/abs/src/contacts.ts", k)).toHaveLength(1);
  });

  it("keeps everything when there is no knowledge", () => {
    expect(filterSuppressed([diag], ds, "/abs/src/contacts.ts", null)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/suppress.test.ts`
Expected: FAIL — cannot find `suppress.js`.

- [ ] **Step 3: Implement**

Create `packages/core/src/knowledge/suppress.ts`:

```ts
import { basename } from "node:path";
import { Node, SyntaxKind } from "ts-morph";
import type { Node as TsNode } from "ts-morph";
import type { QueryDescriptor, Diagnostic } from "../types.js";
import type { Knowledge } from "./types.js";

export function computeAnchor(node: TsNode): { fn: string; anchor: string } {
  const anchor = node.getText().replace(/\s+/g, " ").trim();
  const fnNode = node.getFirstAncestor(
    (a) =>
      Node.isFunctionDeclaration(a) ||
      Node.isFunctionExpression(a) ||
      Node.isArrowFunction(a) ||
      Node.isMethodDeclaration(a),
  );
  let fn = "<module>";
  if (fnNode) {
    if ((Node.isFunctionDeclaration(fnNode) || Node.isMethodDeclaration(fnNode)) && fnNode.getName()) {
      fn = fnNode.getName()!;
    } else {
      const varDecl = fnNode.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      fn = varDecl?.getName() ?? "<anonymous>";
    }
  }
  return { fn, anchor };
}

export function filterSuppressed(
  diags: Diagnostic[],
  descriptors: QueryDescriptor[],
  filePath: string | undefined,
  k: Knowledge | null | undefined,
): Diagnostic[] {
  if (!k || k.suppressions.length === 0) return diags;
  const base = filePath ? basename(filePath) : undefined;
  return diags.filter((diag) => {
    const producer = descriptors.find((d) => d.node.getStart() === diag.range.start);
    if (!producer) return true;
    const { fn, anchor } = computeAnchor(producer.node);
    const suppressed = k.suppressions.some(
      (s) =>
        s.rule === diag.ruleId &&
        s.fn === fn &&
        s.anchor === anchor &&
        (base === undefined || basename(s.file) === base),
    );
    return !suppressed;
  });
}
```

- [ ] **Step 4: Filter in the engine** — modify `packages/core/src/engine.ts`.

Import:

```ts
import { filterSuppressed } from "./knowledge/suppress.js";
```

Replace the final `return diagnostics;` with:

```ts
  return filterSuppressed(diagnostics, descriptors, filePath, knowledge);
```

- [ ] **Step 5: Export from index** — add to `packages/core/src/index.ts`:

```ts
export * from "./knowledge/suppress.js";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/suppress.test.ts test/engine.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/knowledge/suppress.ts packages/core/test/knowledge/suppress.test.ts packages/core/src/engine.ts packages/core/src/index.ts
git commit -m "feat(core): suppression anchor, matching, and engine filtering"
```

---

### Task 10: Suppression store (write entry + fact) and command builder

**Files:**
- Create: `packages/core/src/knowledge/store.ts`
- Test: `packages/core/test/knowledge/store.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Suppression`, `Knowledge`, the `yaml` package.
- Produces:
  - `interface SuggestedFact { table: string; rows: number }`
  - `interface SuppressPlan { suppression: Suppression; suggestedFact?: SuggestedFact }`
  - `function buildSuppressPlan(code: string, filePath: string, line: number, ruleId: string | undefined, k: Knowledge | null): SuppressPlan | { error: string }`
  - `function addSuppression(filePath: string, s: Suppression): void`
  - `function addFact(filePath: string, table: string, rows: number): void`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/knowledge/store.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { buildSuppressPlan, addSuppression, addFact } from "../../src/knowledge/store.js";
import { parseKnowledge } from "../../src/knowledge/load.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("buildSuppressPlan", () => {
  it("locates the diagnostic on a line and produces a suppression + suggested fact", () => {
    const knowledge = parseKnowledge(`version: 1\ntables:\n  user:\n    rows: 10000\n`, "/p")!;
    const code = `async function r(prisma){\n  return prisma.user.findMany();\n}`;
    const plan = buildSuppressPlan(code, "src/x.ts", 2, undefined, knowledge);
    expect("error" in plan).toBe(false);
    const p = plan as Extract<typeof plan, { suppression: unknown }>;
    // The unfiltered read on a table with no filter facts triggers unbounded-read.
    expect(p.suppression.rule).toBe("unbounded-read");
    expect(p.suppression.fn).toBe("r");
    expect(p.suppression.anchor).toBe("prisma.user.findMany()");
    // Cardinality here is a table-source (not a small filter), so no fact is suggested.
    expect(p.suggestedFact).toBeUndefined();
  });

  it("errors when no diagnostic covers the line", () => {
    const code = `async function r(prisma){\n  return prisma.user.findMany({ where: { id: 1 } });\n}`;
    const plan = buildSuppressPlan(code, "src/x.ts", 2, undefined, null);
    expect("error" in plan).toBe(true);
  });
});

describe("addSuppression / addFact", () => {
  it("appends a suppression to a new file and a fact to an existing table", () => {
    dir = mkdtempSync(join(tmpdir(), "qg-"));
    const file = join(dir, "queryguard.knowledge.yaml");

    addSuppression(file, { rule: "n-plus-one", file: "src/x.ts", fn: "r", anchor: "db.q()", reason: "bounded", added: "2026-07-10" });
    let k = parseKnowledge(readFileSync(file, "utf8"), dir)!;
    expect(k.suppressions).toHaveLength(1);
    expect(k.suppressions[0].reason).toBe("bounded");

    addFact(file, "contact", 10);
    k = parseKnowledge(readFileSync(file, "utf8"), dir)!;
    expect(k.tables.contact.rows).toBe(10);
    // Suppression survives the fact write.
    expect(k.suppressions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/store.test.ts`
Expected: FAIL — cannot find `store.js`.

- [ ] **Step 3: Implement**

Create `packages/core/src/knowledge/store.ts`:

```ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { analyzeSource } from "../engine.js";
import { parseSource, findCallExpressions } from "../parse.js";
import { prismaAdapter } from "../adapters/prisma.js";
import { heuristicAdapter } from "../adapters/heuristic.js";
import { computeAnchor } from "./suppress.js";
import { estimateCardinality } from "./cardinality.js";
import type { QueryDescriptor } from "../types.js";
import type { Knowledge, Suppression } from "./types.js";

export interface SuggestedFact {
  table: string;
  rows: number;
}
export interface SuppressPlan {
  suppression: Suppression;
  suggestedFact?: SuggestedFact;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function descriptorsOf(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => prismaAdapter(c) ?? heuristicAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}

export function buildSuppressPlan(
  code: string,
  filePath: string,
  line: number,
  ruleId: string | undefined,
  k: Knowledge | null,
): SuppressPlan | { error: string } {
  const diags = analyzeSource(code, filePath, k).filter((d) => d.range.line === line && (!ruleId || d.ruleId === ruleId));
  if (diags.length === 0) return { error: `no diagnostic on ${filePath}:${line}${ruleId ? ` for rule ${ruleId}` : ""}` };
  if (diags.length > 1) return { error: `multiple diagnostics on line ${line}; pass --rule to choose (${diags.map((d) => d.ruleId).join(", ")})` };

  const diag = diags[0];
  const descriptors = descriptorsOf(code);
  const producer = descriptors.find((d) => d.node.getStart() === diag.range.start);
  if (!producer) return { error: "could not resolve the query for that diagnostic" };

  const { fn, anchor } = computeAnchor(producer.node);
  const suppression: Suppression = { rule: diag.ruleId, file: filePath, fn, anchor, added: today() };

  // Suggest a fact only when the producer's own cardinality is a known small filtered set.
  let suggestedFact: SuggestedFact | undefined;
  const card = estimateCardinality(producer, k);
  if (card.source === "filter" && card.bound === "small" && typeof card.count === "number") {
    suggestedFact = { table: producer.target, rows: card.count };
  }
  return { suppression, suggestedFact };
}

function loadRaw(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return { version: 1, tables: {}, suppressions: [] };
  const raw = parseYaml(readFileSync(filePath, "utf8"));
  if (typeof raw !== "object" || raw === null) return { version: 1, tables: {}, suppressions: [] };
  return raw as Record<string, unknown>;
}

function save(filePath: string, obj: Record<string, unknown>): void {
  writeFileSync(filePath, stringifyYaml(obj), "utf8");
}

export function addSuppression(filePath: string, s: Suppression): void {
  const obj = loadRaw(filePath);
  const list = Array.isArray(obj.suppressions) ? (obj.suppressions as Suppression[]) : [];
  list.push(s);
  obj.version = 1;
  obj.tables = obj.tables ?? {};
  obj.suppressions = list;
  save(filePath, obj);
}

export function addFact(filePath: string, table: string, rows: number): void {
  const obj = loadRaw(filePath);
  const tables = (obj.tables ?? {}) as Record<string, { rows?: number }>;
  tables[table] = { ...(tables[table] ?? {}), rows };
  obj.version = 1;
  obj.tables = tables;
  save(filePath, obj);
}
```

- [ ] **Step 4: Export from index** — add to `packages/core/src/index.ts`:

```ts
export * from "./knowledge/store.js";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @queryguard/core exec vitest run test/knowledge/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/knowledge/store.ts packages/core/test/knowledge/store.test.ts packages/core/src/index.ts
git commit -m "feat(core): suppression plan builder and knowledge-file writers"
```

---

### Task 11: CLI knowledge discovery, flags, and stderr notice

**Files:**
- Modify: `packages/cli/src/run.ts` (discover + pass knowledge)
- Modify: `packages/cli/src/bin.ts` (parse `--knowledge` / `--no-knowledge`, print notice)
- Test: `packages/cli/test/run.test.ts` (append)

**Interfaces:**
- Consumes: `discoverKnowledge`, `loadKnowledge`, `analyzeSource(code, path, knowledge)`.
- Produces:
  - `run(patterns, cwd, options?: { knowledge?: Knowledge | null })` — knowledge threaded to `analyzeSource`.

- [ ] **Step 1: Write the failing test** — append to `packages/cli/test/run.test.ts` (follow the file's existing fixture style; if it writes temp files, mirror that). Minimal shape:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverKnowledge } from "@queryguard/core";
import { run } from "../src/run.js";

it("suppresses over-fetch when a knowledge file marks the read bounded via where", () => {
  const dir = mkdtempSync(join(tmpdir(), "qg-cli-"));
  try {
    writeFileSync(
      join(dir, "queryguard.knowledge.yaml"),
      `version: 1\ntables:\n  user:\n    rows: 10000\n    filters:\n      - when: { status: active }\n        rows: 10\n`,
    );
    writeFileSync(join(dir, "a.ts"), `async function r(prisma){ return prisma.user.findMany(); }`);
    const knowledge = discoverKnowledge(dir);
    return run(["a.ts"], dir, { knowledge }).then(({ diagnostics }) => {
      // over-fetch fires (unfiltered read on large table w/ selective filter)
      expect(diagnostics.some((d) => d.ruleId === "over-fetch")).toBe(true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/cli exec vitest run test/run.test.ts`
Expected: FAIL — `run` does not accept an options arg / knowledge not threaded.

- [ ] **Step 3: Thread knowledge through `run`** — modify `packages/cli/src/run.ts`:

```ts
import type { Diagnostic, Knowledge } from "@queryguard/core";

export interface FileDiagnostic extends Diagnostic {
  file: string;
}

export async function run(
  patterns: string[],
  cwd: string,
  options: { knowledge?: Knowledge | null } = {},
): Promise<{ diagnostics: FileDiagnostic[]; errorCount: number }> {
  const files = await fg(patterns, { cwd, absolute: false });
  const diagnostics: FileDiagnostic[] = [];

  for (const file of files) {
    const abs = join(cwd, file);
    let code: string;
    try {
      code = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    for (const diag of analyzeSource(code, abs, options.knowledge ?? null)) {
      diagnostics.push({ ...diag, file });
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  return { diagnostics, errorCount };
}
```

- [ ] **Step 4: Parse flags + notice in `bin.ts`** — modify `packages/cli/src/bin.ts`:

```ts
#!/usr/bin/env node
import { discoverKnowledge, loadKnowledge } from "@queryguard/core";
import type { Knowledge } from "@queryguard/core";
import { run } from "./run.js";

function parseArgs(argv: string[]): { patterns: string[]; knowledgePath?: string; noKnowledge: boolean } {
  const patterns: string[] = [];
  let knowledgePath: string | undefined;
  let noKnowledge = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-knowledge") noKnowledge = true;
    else if (a === "--knowledge") knowledgePath = argv[++i];
    else patterns.push(a);
  }
  return { patterns, knowledgePath, noKnowledge };
}

async function main() {
  const { patterns, knowledgePath, noKnowledge } = parseArgs(process.argv.slice(2));
  if (patterns.length === 0) {
    console.error("usage: queryguard [--knowledge <path>] [--no-knowledge] <glob> [glob...]");
    process.exit(2);
  }

  let knowledge: Knowledge | null = null;
  if (!noKnowledge) {
    knowledge = knowledgePath ? loadKnowledge(knowledgePath) : discoverKnowledge(process.cwd());
    if (knowledge) console.error(`queryguard: using knowledge from ${knowledgePath ?? "queryguard.knowledge.yaml"}`);
  }

  const { diagnostics, errorCount } = await run(patterns, process.cwd(), { knowledge });

  for (const d of diagnostics) {
    console.log(`${d.file}:${d.range.line}:${d.range.column}  ${d.severity}  ${d.ruleId}  ${d.message}`);
  }
  console.log(`\n${diagnostics.length} problem(s), ${errorCount} error(s)`);
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @queryguard/cli exec vitest run`
Expected: PASS — the new test and all existing CLI tests (existing calls `run(patterns, cwd)` still valid; `options` defaults).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/run.ts packages/cli/src/bin.ts packages/cli/test/run.test.ts
git commit -m "feat(cli): discover and thread the knowledge file into analysis"
```

---

### Task 12: `queryguard suppress` command

**Files:**
- Create: `packages/cli/src/suppress.ts` (command logic, testable without stdin)
- Modify: `packages/cli/src/bin.ts` (dispatch the `suppress` subcommand)
- Test: `packages/cli/test/suppress.test.ts`

**Interfaces:**
- Consumes: `buildSuppressPlan`, `addSuppression`, `addFact`, `discoverKnowledge`, `loadKnowledge`.
- Produces:
  - `interface SuppressOptions { reason?: string; rule?: string; acceptFact: boolean; knowledgePath?: string }`
  - `async function suppressCommand(target: string, cwd: string, opts: SuppressOptions, ask: (q: string) => Promise<string>): Promise<{ code: number; message: string }>`

`target` is `<file>:<line>`. `ask` is injected so tests drive prompts deterministically; `bin.ts` passes a readline-backed `ask`, and `--yes`/`--reason` bypass prompting.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/suppress.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseKnowledge } from "@queryguard/core";
import { suppressCommand } from "../src/suppress.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("suppressCommand", () => {
  it("records a suppression with a supplied reason (non-interactive)", async () => {
    dir = mkdtempSync(join(tmpdir(), "qg-sup-"));
    writeFileSync(join(dir, "a.ts"), `async function r(prisma, ids){\n  for (const id of ids){ await prisma.user.findUnique({ where: { id } }); }\n}`);
    const res = await suppressCommand("a.ts:2", dir, { reason: "ids are bounded", acceptFact: false }, async () => "");
    expect(res.code).toBe(0);

    const k = parseKnowledge(readFileSync(join(dir, "queryguard.knowledge.yaml"), "utf8"), dir)!;
    expect(k.suppressions).toHaveLength(1);
    expect(k.suppressions[0].rule).toBe("n-plus-one");
    expect(k.suppressions[0].reason).toBe("ids are bounded");
  });

  it("errors (code 1) when no diagnostic is on the line", async () => {
    dir = mkdtempSync(join(tmpdir(), "qg-sup-"));
    writeFileSync(join(dir, "a.ts"), `async function r(prisma){\n  return prisma.user.findMany({ where: { id: 1 } });\n}`);
    const res = await suppressCommand("a.ts:2", dir, { acceptFact: false }, async () => "");
    expect(res.code).toBe(1);
    expect(res.message).toMatch(/no diagnostic/);
  });

  it("asks for a reason via the injected prompt when none supplied", async () => {
    dir = mkdtempSync(join(tmpdir(), "qg-sup-"));
    writeFileSync(join(dir, "a.ts"), `async function r(prisma, ids){\n  for (const id of ids){ await prisma.user.findUnique({ where: { id } }); }\n}`);
    let asked = "";
    const res = await suppressCommand("a.ts:2", dir, { acceptFact: false }, async (q) => { asked = q; return "typed reason"; });
    expect(asked.toLowerCase()).toContain("why");
    expect(res.code).toBe(0);
    const k = parseKnowledge(readFileSync(join(dir, "queryguard.knowledge.yaml"), "utf8"), dir)!;
    expect(k.suppressions[0].reason).toBe("typed reason");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @queryguard/cli exec vitest run test/suppress.test.ts`
Expected: FAIL — cannot find `../src/suppress.js`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/suppress.ts`:

```ts
import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { buildSuppressPlan, addSuppression, addFact, discoverKnowledge, loadKnowledge } from "@queryguard/core";
import type { Knowledge } from "@queryguard/core";

export interface SuppressOptions {
  reason?: string;
  rule?: string;
  acceptFact?: boolean;
  knowledgePath?: string;
}

const KNOWLEDGE_FILENAME = "queryguard.knowledge.yaml";

export async function suppressCommand(
  target: string,
  cwd: string,
  opts: SuppressOptions,
  ask: (q: string) => Promise<string>,
): Promise<{ code: number; message: string }> {
  const m = /^(.*):(\d+)$/.exec(target);
  if (!m) return { code: 1, message: `invalid target "${target}" — expected <file>:<line>` };
  const relFile = m[1];
  const line = Number(m[2]);
  const abs = isAbsolute(relFile) ? relFile : join(cwd, relFile);

  let code: string;
  try {
    code = readFileSync(abs, "utf8");
  } catch {
    return { code: 1, message: `cannot read ${abs}` };
  }

  const knowledge: Knowledge | null = opts.knowledgePath
    ? loadKnowledge(opts.knowledgePath)
    : discoverKnowledge(cwd);

  const plan = buildSuppressPlan(code, relFile, line, opts.rule, knowledge);
  if ("error" in plan) return { code: 1, message: plan.error };

  const reason = opts.reason ?? (await ask("why are you suppressing this? (optional — Enter to skip) "));
  const suppression = { ...plan.suppression, reason: reason.trim() || undefined };

  const knowledgeFile = opts.knowledgePath ?? join(cwd, KNOWLEDGE_FILENAME);
  addSuppression(knowledgeFile, suppression);

  let factMsg = "";
  if (plan.suggestedFact) {
    const { table, rows } = plan.suggestedFact;
    const accept =
      opts.acceptFact ?? (await ask(`also record fact tables.${table}.rows = ${rows}? [y/N] `)).trim().toLowerCase() === "y";
    if (accept) {
      addFact(knowledgeFile, table, rows);
      factMsg = ` and recorded fact tables.${table}.rows=${rows}`;
    }
  }

  return { code: 0, message: `suppressed ${suppression.rule} at ${relFile}:${line}${factMsg}` };
}
```

- [ ] **Step 4: Wire into `bin.ts`** — modify `packages/cli/src/bin.ts` to dispatch the subcommand before the analysis path. Add near the top of `main()`, right after computing `process.argv.slice(2)`:

```ts
  const argv = process.argv.slice(2);
  if (argv[0] === "suppress") {
    const { createInterface } = await import("node:readline/promises");
    const rest = argv.slice(1);
    const target = rest.find((a) => !a.startsWith("--")) ?? "";
    const idx = (name: string) => rest.indexOf(name);
    const opt = (name: string) => (idx(name) >= 0 ? rest[idx(name) + 1] : undefined);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = async (q: string) => (await rl.question(q)).trim();
    const { suppressCommand } = await import("./suppress.js");
    const res = await suppressCommand(
      target,
      process.cwd(),
      { reason: opt("--reason"), rule: opt("--rule"), acceptFact: rest.includes("--yes"), knowledgePath: opt("--knowledge") },
      ask,
    );
    rl.close();
    console.log(res.message);
    process.exit(res.code);
  }
```

(The existing `parseArgs(process.argv.slice(2))` line stays for the analysis path; reuse the already-declared `argv` by changing that call to `parseArgs(argv)`.)

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @queryguard/cli exec vitest run`
Expected: PASS — suppress tests + existing CLI tests.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/suppress.ts packages/cli/src/bin.ts packages/cli/test/suppress.test.ts
git commit -m "feat(cli): interactive `queryguard suppress` command with optional fact promotion"
```

---

### Task 13: Docs + full-suite verification

**Files:**
- Create: `docs/database-knowledge/business-logic-context.md`
- Modify: `README.md` (document the knowledge file, the three behaviors, hints, and `suppress`)

**Interfaces:** none (documentation + verification only).

- [ ] **Step 1: Write the knowledge-base note**

Create `docs/database-knowledge/business-logic-context.md` documenting: the `queryguard.knowledge.yaml` schema (tables/rows/filters/thresholds/suppressions), how cardinality drives the three behaviors (silence small, escalate large, over-fetch), the conservative driving-set trace + inline hints (`// queryguard: bounded [n]` / `unbounded`), and the `queryguard suppress <file>:<line> [--rule] [--reason] [--yes] [--knowledge]` command with the anchor-based (line-independent) matching model. Mirror the tone/length of the existing `docs/database-knowledge/prisma.md`.

- [ ] **Step 2: Update the README**

In `README.md`, under the rules/usage area, add a "Business-logic context" subsection: the knowledge-file example from the spec, the `--knowledge` / `--no-knowledge` flags, and a one-paragraph `queryguard suppress` walkthrough. Keep the existing "100% static" promise prominent (note the knowledge file is local, human-authored, never transmitted).

- [ ] **Step 3: Build everything**

Run: `pnpm build`
Expected: all packages build with no type errors (confirms cross-package `Knowledge` type export from `@queryguard/core` resolves in the CLI).

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS — the entire suite, including every pre-existing test (identity guarantee) plus all new tests from Tasks 1-12.

- [ ] **Step 5: Manual smoke check**

```bash
mkdir -p /tmp/qg-smoke && cd /tmp/qg-smoke
printf 'version: 1\ntables:\n  user:\n    rows: 10000\n    filters:\n      - when: { status: active }\n        rows: 10\n' > queryguard.knowledge.yaml
printf 'async function r(prisma){ return prisma.user.findMany(); }\n' > a.ts
node "$OLDPWD/packages/cli/dist/bin.js" "a.ts"
```
Expected: an `over-fetch` warning mentioning `status=active (~10)`; stderr notes the knowledge file is in use.

- [ ] **Step 6: Commit**

```bash
git add docs/database-knowledge/business-logic-context.md README.md
git commit -m "docs: business-logic context knowledge file, hints, and suppress command"
```

---

## Notes for the implementer

- **Anchor fragility is intentional.** Normalized full-call-text means reformatting whitespace is fine, but renaming a variable inside the call lapses the suppression — the warning returns for re-evaluation. This is the designed behavior (§11 of the spec), not a bug.
- **YAML round-trip drops comments.** `store.ts` uses `yaml.parse` → mutate → `yaml.stringify`, so hand-written comments in the knowledge file are not preserved across a `suppress` write. Acceptable for v1; a `parseDocument`-based comment-preserving writer is a later refinement.
- **File matching is by basename** in `filterSuppressed` (v1). Two files with the same basename, same fn, same anchor, and the same rule would share a suppression. Rare; a project-relative path match is a later refinement.
- Keep every new `RuleContext` field optional — that is what preserves the byte-identical-with-no-knowledge guarantee and keeps the pre-existing rule tests green.
