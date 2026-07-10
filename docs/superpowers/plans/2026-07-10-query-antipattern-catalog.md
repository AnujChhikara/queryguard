# Query Anti-Pattern Catalog v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the engine from a single Prisma-only N+1 rule into a small catalog on a shared recognition foundation: per-ORM adapters (Prisma) + a heuristic fallback for no-ORM code, feeding a `query-in-loop` rule (reads+writes, ORM=error / heuristic=warning) and a high-signal `unbounded-read` rule.

**Architecture:** Extend `QueryDescriptor` with `hasLimit`/`hasFilter`/`confidence`. `prismaAdapter` populates them precisely (`confidence:"high"`); a new `heuristicAdapter` recognizes awaited query-like calls in non-ORM code (`confidence:"heuristic"`, shape fields `undefined`). Rules consume descriptors: `query-in-loop` on all descriptors (severity by confidence); `unbounded-read` only when both shape fields are known `false`.

**Tech Stack:** TypeScript, ts-morph, vitest (existing `@queryguard/core` package).

**Spec:** `docs/superpowers/specs/2026-07-10-query-antipattern-catalog-design.md`

## Global Constraints

- Precision-first: a *known* (Prisma) query in a loop is a red **error**; every inferred finding (heuristic recognition, `unbounded-read`) is a yellow **warning**. Never an error on a heuristic match.
- `undefined` = "unknown", `false` = "known absent". Shape rules fire only on known (`false`) fields, never on `undefined`. This is the single contract every consumer respects.
- `confidence` is a **required** field on `QueryDescriptor` (`"high" | "heuristic"`); every adapter must set it.
- Heuristic adapter runs **after** `prismaAdapter` (first-match-wins) so real Prisma calls are never claimed by the heuristic.
- Rule id for the loop rule stays **`n-plus-one`** (broaden behavior, do not rename — knowledge base + docsUrl reference it).
- `unbounded-read` requires BOTH `hasFilter === false` AND `hasLimit === false`.
- Best-effort: adapters return `null` for anything unrecognized; a thrown rule is caught by the engine; unparsable files yield no diagnostics.
- All work lands on `main` (user directed no feature branches). Commit per task; push is handled by the controller.

---

### Task 1: Extend `QueryDescriptor`; populate it precisely in `prismaAdapter`

**Files:**
- Modify: `packages/core/src/types.ts` (QueryDescriptor interface)
- Modify: `packages/core/src/adapters/prisma.ts`
- Test: `packages/core/test/adapters/prisma.test.ts`

**Interfaces:**
- Produces: `QueryDescriptor` with new fields `hasLimit?: boolean`, `hasFilter?: boolean`, `confidence: "high" | "heuristic"`. `prismaAdapter(call): QueryDescriptor | null` now sets `confidence:"high"`, `hasLimit`, `hasFilter`, and `selectedFields`.

- [ ] **Step 1: Extend the `QueryDescriptor` interface**

In `packages/core/src/types.ts`, replace the `QueryDescriptor` interface with:

```ts
export interface QueryDescriptor {
  db: string;
  orm: string;
  operation: "read" | "write" | "delete" | "unknown";
  target: string;
  selectedFields?: string[];
  hasLimit?: boolean;
  hasFilter?: boolean;
  node: Node;
  inLoop: boolean;
  awaited: boolean;
  confidence: "high" | "heuristic";
}
```

- [ ] **Step 2: Write failing tests for the new Prisma descriptor fields**

Append these tests inside the `describe("prismaAdapter", ...)` block in `packages/core/test/adapters/prisma.test.ts`:

```ts
it("marks prisma descriptors as high confidence", () => {
  const call = firstCall(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
  expect(prismaAdapter(call)!.confidence).toBe("high");
});

it("detects presence of where (hasFilter) and take (hasLimit)", () => {
  const withBoth = firstCall(`async function r(prisma){ await prisma.user.findMany({ where: { id: 1 }, take: 10 }); }`, "prisma.user.findMany");
  const d1 = prismaAdapter(withBoth)!;
  expect(d1.hasFilter).toBe(true);
  expect(d1.hasLimit).toBe(true);

  const withNeither = firstCall(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
  const d2 = prismaAdapter(withNeither)!;
  expect(d2.hasFilter).toBe(false);
  expect(d2.hasLimit).toBe(false);
});

it("collects selected fields from a select object", () => {
  const call = firstCall(`async function r(prisma){ await prisma.user.findMany({ select: { id: true, name: true } }); }`, "prisma.user.findMany");
  expect(prismaAdapter(call)!.selectedFields).toEqual(["id", "name"]);
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pnpm --filter @queryguard/core test -- adapters/prisma`
Expected: FAIL — `confidence`/`hasFilter`/`hasLimit`/`selectedFields` are `undefined`.

- [ ] **Step 4: Populate the new fields in `prismaAdapter`**

In `packages/core/src/adapters/prisma.ts`, add this helper above `prismaAdapter` (after the imports):

```ts
function readOptions(call: CallExpression): {
  hasLimit: boolean;
  hasFilter: boolean;
  selectedFields: string[];
} {
  const [firstArg] = call.getArguments();
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) {
    return { hasLimit: false, hasFilter: false, selectedFields: [] };
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
  return { hasLimit: hasProp("take"), hasFilter: hasProp("where"), selectedFields };
}
```

Then, in the returned descriptor object of `prismaAdapter`, add the fields. Replace the `return { ... }` block with:

```ts
  const options = readOptions(call);

  return {
    db: "postgres",
    orm: "prisma",
    operation: operationFor(method),
    target: model,
    node: call,
    inLoop: isInsideLoop(call),
    awaited: isAwaited,
    confidence: "high",
    hasLimit: options.hasLimit,
    hasFilter: options.hasFilter,
    selectedFields: options.selectedFields,
  };
```

- [ ] **Step 5: Run the full core suite to verify pass + no regression**

Run: `pnpm --filter @queryguard/core test`
Expected: PASS — new prisma tests pass; existing prisma/n-plus-one/engine tests still pass (n-plus-one still `error`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/adapters/prisma.ts packages/core/test/adapters/prisma.test.ts
git commit -m "feat(core): extend QueryDescriptor with confidence/hasLimit/hasFilter; populate in prisma adapter"
```

---

### Task 2: Heuristic fallback adapter + engine registration

**Files:**
- Create: `packages/core/src/adapters/heuristic.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/adapters/heuristic.test.ts`

**Interfaces:**
- Consumes: `QueryDescriptor` (with `confidence`), `isInsideLoop` from `../loop.js`.
- Produces: `heuristicAdapter(call: CallExpression): QueryDescriptor | null` — sets `confidence:"heuristic"`, `operation:"unknown"`, `hasLimit`/`hasFilter`/`selectedFields` = `undefined`. Registered in `engine.ts` after `prismaAdapter`.

- [ ] **Step 1: Write failing tests `packages/core/test/adapters/heuristic.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { heuristicAdapter } from "../../src/adapters/heuristic.js";

function firstCall(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === calleeText)!;
}

describe("heuristicAdapter", () => {
  it("recognizes an awaited custom data-access call (verb match)", () => {
    const call = firstCall(`async function r(){ await dataAccess.retrieveUsers({ id: 1 }); }`, "dataAccess.retrieveUsers");
    const d = heuristicAdapter(call);
    expect(d).not.toBeNull();
    expect(d!.confidence).toBe("heuristic");
    expect(d!.operation).toBe("unknown");
    expect(d!.hasLimit).toBeUndefined();
    expect(d!.hasFilter).toBeUndefined();
  });

  it("recognizes an awaited call on a data-source receiver (mongoose find)", () => {
    const call = firstCall(`async function r(User){ await User.find({ active: true }); }`, "User.find");
    // 'find' is a query verb -> recognized
    expect(heuristicAdapter(call)).not.toBeNull();
  });

  it("does NOT recognize a synchronous array method (not awaited)", () => {
    const call = firstCall(`function r(arr){ return arr.find(x => x.id === 1); }`, "arr.find");
    expect(heuristicAdapter(call)).toBeNull();
  });

  it("does NOT recognize a blocklisted method even if awaited", () => {
    const call = firstCall(`async function r(res, data){ await res.json(data); }`, "res.json");
    expect(heuristicAdapter(call)).toBeNull();
  });

  it("does NOT recognize a bare function call (no property access)", () => {
    const call = firstCall(`async function r(){ await getUser(1); }`, "getUser");
    expect(heuristicAdapter(call)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @queryguard/core test -- adapters/heuristic`
Expected: FAIL — cannot resolve `../../src/adapters/heuristic.js`.

- [ ] **Step 3: Implement `packages/core/src/adapters/heuristic.ts`**

```ts
import { Node } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import { isInsideLoop } from "../loop.js";

const QUERY_VERBS = new Set([
  "find", "findone", "findbyid", "findmany", "get", "getby", "retrieve",
  "fetch", "query", "select", "aggregate", "count", "list", "search",
  "load", "lookup", "exists",
]);

const DATA_SOURCE_NAMES = new Set([
  "db", "database", "repo", "repository", "model", "models", "dao",
  "dataaccess", "store", "collection", "knex", "prisma", "mongoose",
  "sequelize", "em", "entitymanager",
]);

const BLOCKLIST = new Set([
  "map", "foreach", "filter", "reduce", "some", "every", "flatmap",
  "slice", "concat", "join", "keys", "values", "entries", "has", "add",
  "then", "catch", "finally", "json", "send", "status", "end",
]);

function looksLikeQueryVerb(method: string): boolean {
  const m = method.toLowerCase();
  if (QUERY_VERBS.has(m)) return true;
  // prefix forms like getById, getAllUserStatus, findByEmail
  return m.startsWith("get") || m.startsWith("find") || m.startsWith("retrieve") || m.startsWith("fetch");
}

export function heuristicAdapter(call: CallExpression): QueryDescriptor | null {
  // 1. must be directly awaited
  if (!Node.isAwaitExpression(call.getParent())) return null;

  // 2. callee must be a property access <receiver>.<method>
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const method = expr.getName();

  // 4. never match blocklisted methods
  if (BLOCKLIST.has(method.toLowerCase())) return null;

  // 3. method is a query verb OR receiver is a data-source name
  const receiverText = expr.getExpression().getText();
  const receiverLeaf = receiverText.split(".").pop() ?? receiverText;
  const receiverMatches = DATA_SOURCE_NAMES.has(receiverLeaf.toLowerCase());
  if (!looksLikeQueryVerb(method) && !receiverMatches) return null;

  return {
    db: "unknown",
    orm: "heuristic",
    operation: "unknown",
    target: method,
    node: call,
    inLoop: isInsideLoop(call),
    awaited: true,
    confidence: "heuristic",
    selectedFields: undefined,
    hasLimit: undefined,
    hasFilter: undefined,
  };
}
```

- [ ] **Step 4: Register the adapter in `packages/core/src/engine.ts`**

Add the import after the `prismaAdapter` import:

```ts
import { heuristicAdapter } from "./adapters/heuristic.js";
```

Replace the `adapters` array line with:

```ts
const adapters: Array<(call: CallExpression) => QueryDescriptor | null> = [prismaAdapter, heuristicAdapter];
```

- [ ] **Step 5: Export the adapter from the barrel `packages/core/src/index.ts`**

Add after the prisma adapter export line:

```ts
export * from "./adapters/heuristic.js";
```

- [ ] **Step 6: Run the core suite to verify pass + no regression**

Run: `pnpm --filter @queryguard/core test`
Expected: PASS — heuristic tests pass; existing engine test still reports exactly 1 `n-plus-one` (prisma claims the prisma call before the heuristic; the batched non-loop query still yields 0).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/adapters/heuristic.ts packages/core/src/engine.ts packages/core/src/index.ts packages/core/test/adapters/heuristic.test.ts
git commit -m "feat(core): add heuristic fallback adapter for no-ORM query calls"
```

---

### Task 3: Broaden `n-plus-one` (query-in-loop) — severity by confidence

**Files:**
- Modify: `packages/core/src/rules/n-plus-one.ts`
- Test: `packages/core/test/rules/n-plus-one.test.ts`
- Test: `packages/core/test/engine.test.ts`

**Interfaces:**
- Consumes: `QueryDescriptor.confidence`, `.inLoop`, `.operation`, `.target`.
- Produces: `nPlusOneRule` emitting `error` for `confidence:"high"` and `warning` for `confidence:"heuristic"`, for any `inLoop` descriptor (reads and writes).

- [ ] **Step 1: Write failing tests for confidence-based severity**

Add to `packages/core/test/rules/n-plus-one.test.ts` (the `descriptors()` helper there uses `prismaAdapter`; add a second helper for heuristic). Insert after the existing imports:

```ts
import { heuristicAdapter } from "../../src/adapters/heuristic.js";

function heuristicDescriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => heuristicAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}
```

Then add these tests inside the `describe("nPlusOneRule", ...)` block:

```ts
it("flags a heuristic (no-ORM) query in a loop as a WARNING", () => {
  const ctx = { descriptors: heuristicDescriptors(`async function r(items){ await Promise.all(items.map(async (i) => { await dataAccess.retrieveUsers({ id: i.id }); })); }`) };
  const diags = nPlusOneRule.match(ctx);
  expect(diags).toHaveLength(1);
  expect(diags[0].ruleId).toBe("n-plus-one");
  expect(diags[0].severity).toBe("warning");
});

it("keeps a prisma query in a loop as an ERROR", () => {
  const ctx = { descriptors: descriptors(`async function r(prisma, ids){ for (const id of ids){ await prisma.user.findUnique({ where: { id } }); } }`) };
  expect(nPlusOneRule.match(ctx)[0].severity).toBe("error");
});
```

- [ ] **Step 2: Run to verify the new heuristic test fails**

Run: `pnpm --filter @queryguard/core test -- rules/n-plus-one`
Expected: FAIL — the heuristic-in-loop diagnostic currently comes back `error`, not `warning`.

- [ ] **Step 3: Update the rule in `packages/core/src/rules/n-plus-one.ts`**

Replace the whole file with:

```ts
import type { Rule } from "../types.js";
import { makeDiagnostic } from "../types.js";

export const nPlusOneRule: Rule = {
  id: "n-plus-one",
  defaultSeverity: "error",
  match(ctx) {
    return ctx.descriptors
      .filter((d) => d.inLoop)
      .map((d) => {
        const severity = d.confidence === "high" ? "error" : "warning";
        const message =
          d.confidence === "high"
            ? `Query on "${d.target}" runs inside a loop (N+1). Batch it into a single query (e.g. a WHERE ... IN / findMany).`
            : `Possible N+1: "${d.target}" looks like a query called inside a loop. If it hits the database, batch it into a single query.`;
        return makeDiagnostic({
          ruleId: "n-plus-one",
          severity,
          message,
          node: d.node,
          docsUrl: "https://queryguard.dev/rules/n-plus-one",
        });
      });
  },
};
```

- [ ] **Step 4: Add an engine-level end-to-end test for the no-ORM warning**

Add to `packages/core/test/engine.test.ts` inside `describe("analyzeSource", ...)`:

```ts
it("warns on a no-ORM query in a loop (heuristic)", () => {
  const diags = analyzeSource(`
    async function getAll(items) {
      await Promise.all(items.map(async (i) => {
        const u = await dataAccess.retrieveUsers({ id: i.id });
        return u;
      }));
    }
  `);
  expect(diags).toHaveLength(1);
  expect(diags[0].ruleId).toBe("n-plus-one");
  expect(diags[0].severity).toBe("warning");
});
```

- [ ] **Step 5: Run the core suite to verify pass**

Run: `pnpm --filter @queryguard/core test`
Expected: PASS — heuristic-in-loop is `warning`, prisma-in-loop stays `error`, all prior tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/rules/n-plus-one.ts packages/core/test/rules/n-plus-one.test.ts packages/core/test/engine.test.ts
git commit -m "feat(core): broaden n-plus-one to all query-in-loop with confidence-based severity"
```

---

### Task 4: `unbounded-read` rule + engine registration

**Files:**
- Create: `packages/core/src/rules/unbounded-read.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/rules/unbounded-read.test.ts`
- Test: `packages/core/test/engine.test.ts`

**Interfaces:**
- Consumes: `QueryDescriptor.operation`, `.hasFilter`, `.hasLimit`, `.target`, `.node`.
- Produces: `unboundedReadRule: Rule` (id `unbounded-read`) emitting a `warning` when `operation==="read" && hasFilter===false && hasLimit===false`. Registered in `engine.ts`.

- [ ] **Step 1: Write failing tests `packages/core/test/rules/unbounded-read.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { heuristicAdapter } from "../../src/adapters/heuristic.js";
import { unboundedReadRule } from "../../src/rules/unbounded-read.js";
import type { QueryDescriptor } from "../../src/types.js";

function prismaDescriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => prismaAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}
function heuristicDescriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => heuristicAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}

describe("unboundedReadRule", () => {
  it("warns on a read with neither where nor take", () => {
    const ctx = { descriptors: prismaDescriptors(`async function r(prisma){ await prisma.user.findMany(); }`) };
    const diags = unboundedReadRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("unbounded-read");
    expect(diags[0].severity).toBe("warning");
  });

  it("does NOT warn when a where is present (canonical batched read)", () => {
    const ctx = { descriptors: prismaDescriptors(`async function r(prisma, ids){ await prisma.user.findMany({ where: { id: { in: ids } } }); }`) };
    expect(unboundedReadRule.match(ctx)).toHaveLength(0);
  });

  it("does NOT warn when a take is present", () => {
    const ctx = { descriptors: prismaDescriptors(`async function r(prisma){ await prisma.user.findMany({ take: 20 }); }`) };
    expect(unboundedReadRule.match(ctx)).toHaveLength(0);
  });

  it("does NOT warn on a heuristic (no-ORM) call with unknown shape", () => {
    const ctx = { descriptors: heuristicDescriptors(`async function r(){ await dataAccess.retrieveUsers({ id: 1 }); }`) };
    expect(unboundedReadRule.match(ctx)).toHaveLength(0);
  });

  it("does NOT warn on a write", () => {
    const ctx = { descriptors: prismaDescriptors(`async function r(prisma){ await prisma.user.create({ data: {} }); }`) };
    expect(unboundedReadRule.match(ctx)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @queryguard/core test -- rules/unbounded-read`
Expected: FAIL — cannot resolve `../../src/rules/unbounded-read.js`.

- [ ] **Step 3: Implement `packages/core/src/rules/unbounded-read.ts`**

```ts
import type { Rule } from "../types.js";
import { makeDiagnostic } from "../types.js";

export const unboundedReadRule: Rule = {
  id: "unbounded-read",
  defaultSeverity: "warning",
  match(ctx) {
    return ctx.descriptors
      .filter(
        (d) =>
          d.operation === "read" &&
          d.hasFilter === false &&
          d.hasLimit === false,
      )
      .map((d) =>
        makeDiagnostic({
          ruleId: "unbounded-read",
          severity: "warning",
          message: `Read on "${d.target}" has no filter and no limit — this may scan the whole table. Add a WHERE/where or a LIMIT/take.`,
          node: d.node,
          docsUrl: "https://queryguard.dev/rules/unbounded-read",
        }),
      );
  },
};
```

- [ ] **Step 4: Register the rule in `packages/core/src/engine.ts`**

Add the import after the `nPlusOneRule` import:

```ts
import { unboundedReadRule } from "./rules/unbounded-read.js";
```

Replace the `rules` array line with:

```ts
const rules: Rule[] = [nPlusOneRule, unboundedReadRule];
```

- [ ] **Step 5: Export from the barrel `packages/core/src/index.ts`**

Add after the n-plus-one export line:

```ts
export * from "./rules/unbounded-read.js";
```

- [ ] **Step 6: Update the existing engine "batched query" expectation**

The batched-query test in `packages/core/test/engine.test.ts` uses `prisma.user.findMany({ where: { id: { in: ids } } })`, which has a filter, so `unbounded-read` does NOT fire and it must still yield 0. Verify it is unchanged and add one positive engine test for `unbounded-read`:

```ts
it("warns unbounded-read on a filterless, limitless prisma read", () => {
  const diags = analyzeSource(`async function all(prisma){ return prisma.user.findMany(); }`);
  expect(diags).toHaveLength(1);
  expect(diags[0].ruleId).toBe("unbounded-read");
  expect(diags[0].severity).toBe("warning");
});
```

- [ ] **Step 7: Run the full core suite**

Run: `pnpm --filter @queryguard/core test`
Expected: PASS — unbounded-read fires only on filterless+limitless reads; the canonical batched read and all prior tests stay green.

- [ ] **Step 8: Build the whole workspace to confirm no downstream type break (cli/vscode consume core)**

Run: `pnpm -r build`
Expected: PASS — `@queryguard/core`, `@queryguard/cli`, and `queryguard-vscode` all build (the new required `confidence` field is only constructed inside adapters, so consumers are unaffected).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/rules/unbounded-read.ts packages/core/src/engine.ts packages/core/src/index.ts packages/core/test/rules/unbounded-read.test.ts packages/core/test/engine.test.ts
git commit -m "feat(core): add unbounded-read rule (no filter and no limit)"
```

---

## Self-Review

**Spec coverage:**
- §2 richer `QueryDescriptor` (hasLimit/hasFilter/confidence) → Task 1. ✓
- §2 rule registry (formalized `rules[]`) → Tasks 2 & 4 register into the existing arrays. ✓
- §2 heuristic fallback adapter → Task 2. ✓
- §2 rules: `query-in-loop` (reads+writes, confidence severity) → Task 3; `unbounded-read` → Task 4. ✓
- §3.1 descriptor `undefined`=unknown / `false`=known → Task 1 (prisma sets `false` when absent), Task 2 (heuristic leaves `undefined`), Task 4 (rule requires `false`). ✓
- §4 heuristic recognition (awaited, property-access, verbs/receivers, blocklist) → Task 2 Step 3. ✓
- §5.1 rule id stays `n-plus-one`, reads+writes, confidence severity → Task 3. ✓
- §5.2 `unbounded-read` both-clauses-absent, warning, preserves batched example, no-ORM never fires → Task 4 tests. ✓
- §5.3 prisma populates hasLimit/hasFilter/selectedFields/confidence → Task 1. ✓
- §6 no extension change → confirmed by Task 4 Step 8 building `queryguard-vscode` unchanged. ✓
- §8 testing (per-rule positive+negative, regression, no-ORM) → Tasks 1–4 tests. ✓
- §9 success criteria (custom snippet → warning; filterless+limitless prisma read → warning; batched → nothing; no-ORM never shape-flags) → Task 3 + Task 4 tests. ✓
- over-fetch / separate limit+filter rules → correctly ABSENT (deferred per updated spec §2). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code and command step is concrete.

**Type consistency:** `confidence: "high" | "heuristic"` is defined in Task 1 and set by every adapter (Task 1 prisma, Task 2 heuristic). `hasLimit`/`hasFilter` are `boolean|undefined`, set `false`/`true` by prisma (Task 1), left `undefined` by heuristic (Task 2), and compared `=== false` by `unbounded-read` (Task 4) — consistent. Rule id `n-plus-one` retained (Task 3); new rule id `unbounded-read` (Task 4). Helper `readOptions` (Task 1) and `looksLikeQueryVerb` (Task 2) are each defined before use.
