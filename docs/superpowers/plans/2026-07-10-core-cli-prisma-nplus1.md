# QueryGuard Plan 1: Core Engine + CLI + Prisma N+1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `queryguard` CLI that statically detects N+1 database access (a Prisma query call inside a loop) in TypeScript files and exits non-zero when it finds one.

**Architecture:** A framework-agnostic `@queryguard/core` package parses TS with ts-morph, an adapter normalizes recognized query calls into `QueryDescriptor`s, and rules consume descriptors + AST context to emit `Diagnostic`s. A thin `@queryguard/cli` package globs files, runs the engine, prints diagnostics, and sets the exit code. This is the first vertical slice of the three-lane pipeline: only Lane 1 (syntactic) with a single rule and a single adapter.

**Tech Stack:** TypeScript, pnpm workspaces, ts-morph (AST), Vitest (tests), tsup (build), fast-glob (CLI file discovery).

## Global Constraints

- Language target: TypeScript/JavaScript only. Copied from spec §2.
- 100% static: no LLM, no network, no DB connection. Copied from spec §2.
- Analysis is best-effort: a throwing rule or unparsable file must never crash the run. Copied from spec §2/§7.
- Precision-first: only emit a diagnostic when the pattern is unambiguous. Copied from spec §1.
- Package names: `@queryguard/core`, `@queryguard/cli`. Copied from spec §3.
- Node engine floor: Node >= 18.

---

### Task 1: Monorepo scaffold + tooling

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working `pnpm -r test` and `@queryguard/core` package resolvable from `packages/core/src/index.ts`.

- [ ] **Step 1: Create the root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`package.json` (root):
```json
{
  "name": "queryguard",
  "private": true,
  "version": "0.0.0",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "tsup": "^8.0.0"
  }
}
```

`.gitignore`:
```
node_modules
dist
*.log
.DS_Store
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 2: Create the core package files**

`packages/core/package.json`:
```json
{
  "name": "@queryguard/core",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "test": "vitest run",
    "build": "tsup src/index.ts --format esm --dts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "ts-morph": "^23.0.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

`packages/core/src/index.ts`:
```ts
export const VERSION = "0.0.0";
```

`packages/core/test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { VERSION } from "../src/index.js";

describe("core smoke", () => {
  it("exposes a version", () => {
    expect(VERSION).toBe("0.0.0");
  });
});
```

- [ ] **Step 3: Install dependencies**

Run: `cd /Users/anujchhikara/anuj/projects/queryguard && pnpm install`
Expected: installs without error; `node_modules` created at root and workspace links present.

- [ ] **Step 4: Run the smoke test**

Run: `pnpm -r test`
Expected: PASS — 1 test passing in `@queryguard/core`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with core package"
```

---

### Task 2: Core types (`Diagnostic`, `Severity`, `QueryDescriptor`, `Rule`)

**Files:**
- Create: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Severity = "error" | "warning" | "info"`
  - `interface SourceRange { start: number; end: number; line: number; column: number }`
  - `interface Diagnostic { ruleId: string; severity: Severity; message: string; range: SourceRange; docsUrl?: string }`
  - `interface QueryDescriptor { db: string; orm: string; operation: "read" | "write" | "delete" | "unknown"; target: string; selectedFields?: string[]; node: import("ts-morph").Node; inLoop: boolean; awaited: boolean }`
  - `interface Rule { id: string; defaultSeverity: Severity; match(ctx: RuleContext): Diagnostic[] }`
  - `interface RuleContext { descriptors: QueryDescriptor[] }`
  - `function makeDiagnostic(input: { ruleId: string; severity: Severity; message: string; node: import("ts-morph").Node; docsUrl?: string }): Diagnostic`

- [ ] **Step 1: Write the failing test**

`packages/core/test/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { makeDiagnostic } from "../src/types.js";

describe("makeDiagnostic", () => {
  it("builds a diagnostic with a range derived from the node", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("t.ts", "const x = 1;");
    const node = sf.getFirstDescendantOrThrow((n) => n.getText() === "1");

    const diag = makeDiagnostic({
      ruleId: "test-rule",
      severity: "error",
      message: "boom",
      node,
      docsUrl: "https://example.com",
    });

    expect(diag.ruleId).toBe("test-rule");
    expect(diag.severity).toBe("error");
    expect(diag.message).toBe("boom");
    expect(diag.docsUrl).toBe("https://example.com");
    expect(diag.range.start).toBe(node.getStart());
    expect(diag.range.end).toBe(node.getEnd());
    expect(diag.range.line).toBeGreaterThanOrEqual(1);
    expect(diag.range.column).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/types.test.ts`
Expected: FAIL — cannot find module `../src/types.js` / `makeDiagnostic` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/types.ts`:
```ts
import type { Node } from "ts-morph";

export type Severity = "error" | "warning" | "info";

export interface SourceRange {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  range: SourceRange;
  docsUrl?: string;
}

export interface QueryDescriptor {
  db: string;
  orm: string;
  operation: "read" | "write" | "delete" | "unknown";
  target: string;
  selectedFields?: string[];
  node: Node;
  inLoop: boolean;
  awaited: boolean;
}

export interface RuleContext {
  descriptors: QueryDescriptor[];
}

export interface Rule {
  id: string;
  defaultSeverity: Severity;
  match(ctx: RuleContext): Diagnostic[];
}

export function makeDiagnostic(input: {
  ruleId: string;
  severity: Severity;
  message: string;
  node: Node;
  docsUrl?: string;
}): Diagnostic {
  const { ruleId, severity, message, node, docsUrl } = input;
  const start = node.getStart();
  const lineAndCol = node.getSourceFile().getLineAndColumnAtPos(start);
  return {
    ruleId,
    severity,
    message,
    docsUrl,
    range: {
      start,
      end: node.getEnd(),
      line: lineAndCol.line,
      column: lineAndCol.column,
    },
  };
}
```

`packages/core/src/index.ts` (replace contents):
```ts
export const VERSION = "0.0.0";
export * from "./types.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): add diagnostic and query-descriptor types"
```

---

### Task 3: Parse helper + query-call collection

**Files:**
- Create: `packages/core/src/parse.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/parse.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `function parseSource(code: string, filePath?: string): import("ts-morph").SourceFile`
  - `function findCallExpressions(sourceFile: import("ts-morph").SourceFile): import("ts-morph").CallExpression[]`

- [ ] **Step 1: Write the failing test**

`packages/core/test/parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../src/parse.js";

describe("parse", () => {
  it("returns all call expressions in a source file", () => {
    const sf = parseSource(`
      async function run(db) {
        await db.user.findMany();
        console.log("hi");
      }
    `);
    const calls = findCallExpressions(sf).map((c) => c.getExpression().getText());
    expect(calls).toContain("db.user.findMany");
    expect(calls).toContain("console.log");
  });

  it("does not throw on syntactically incomplete code", () => {
    expect(() => parseSource("const x = ")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/parse.test.ts`
Expected: FAIL — module `../src/parse.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/parse.ts`:
```ts
import { Project, SyntaxKind } from "ts-morph";
import type { SourceFile, CallExpression } from "ts-morph";

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: { allowJs: true },
  skipFileDependencyResolution: true,
});

let counter = 0;

export function parseSource(code: string, filePath?: string): SourceFile {
  const name = filePath ?? `__queryguard_${counter++}.ts`;
  return project.createSourceFile(name, code, { overwrite: true });
}

export function findCallExpressions(sourceFile: SourceFile): CallExpression[] {
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
}
```

`packages/core/src/index.ts` (append export):
```ts
export * from "./parse.js";
```
(Keep the existing `VERSION` and `types` exports; add the line above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/parse.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): add source parsing and call-expression collection"
```

---

### Task 4: Loop-context detection

**Files:**
- Create: `packages/core/src/loop.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/loop.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function isInsideLoop(node: import("ts-morph").Node): boolean` — true when the node has an ancestor that is a `for`/`for..of`/`for..in`/`while`/`do..while` statement, OR is inside the callback of an array iteration method (`.map` / `.forEach` / `.flatMap`).

- [ ] **Step 1: Write the failing test**

`packages/core/test/loop.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../src/parse.js";
import { isInsideLoop } from "../src/loop.js";

function callNamed(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === calleeText)!;
}

describe("isInsideLoop", () => {
  it("is true for a call inside a for-of loop", () => {
    const call = callNamed(
      `async function r(db, ids){ for (const id of ids){ await db.user.findUnique({ where: { id } }); } }`,
      "db.user.findUnique",
    );
    expect(isInsideLoop(call)).toBe(true);
  });

  it("is true for a call inside an array .map callback", () => {
    const call = callNamed(
      `async function r(db, ids){ await Promise.all(ids.map((id) => db.user.findUnique({ where: { id } }))); }`,
      "db.user.findUnique",
    );
    expect(isInsideLoop(call)).toBe(true);
  });

  it("is false for a top-level call", () => {
    const call = callNamed(
      `async function r(db){ await db.user.findMany(); }`,
      "db.user.findMany",
    );
    expect(isInsideLoop(call)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/loop.test.ts`
Expected: FAIL — module `../src/loop.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/loop.ts`:
```ts
import { Node } from "ts-morph";

const ITERATION_METHODS = new Set(["map", "forEach", "flatMap"]);

export function isInsideLoop(node: Node): boolean {
  const loopAncestor = node.getFirstAncestor(
    (a) =>
      Node.isForStatement(a) ||
      Node.isForOfStatement(a) ||
      Node.isForInStatement(a) ||
      Node.isWhileStatement(a) ||
      Node.isDoStatement(a),
  );
  if (loopAncestor) return true;

  // Inside the callback of arr.map(...) / arr.forEach(...) / arr.flatMap(...)
  const iterationCallAncestor = node.getFirstAncestor((a) => {
    if (!Node.isCallExpression(a)) return false;
    const expr = a.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return false;
    return ITERATION_METHODS.has(expr.getName());
  });
  return Boolean(iterationCallAncestor);
}
```

`packages/core/src/index.ts` (append export):
```ts
export * from "./loop.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/loop.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): detect loop and array-iteration context for a node"
```

---

### Task 5: Prisma adapter (`CallExpression` → `QueryDescriptor | null`)

**Files:**
- Create: `packages/core/src/adapters/prisma.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/adapters/prisma.test.ts`

**Interfaces:**
- Consumes: `QueryDescriptor` (Task 2), `isInsideLoop` (Task 4), `CallExpression`/`Node` (ts-morph).
- Produces: `function prismaAdapter(call: import("ts-morph").CallExpression): QueryDescriptor | null` — returns a descriptor when the call matches `<ident>.<model>.<prismaMethod>(...)`, else `null`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/adapters/prisma.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";

function firstCall(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === calleeText)!;
}

describe("prismaAdapter", () => {
  it("recognizes a findMany read call and fills the descriptor", () => {
    const call = firstCall(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
    const d = prismaAdapter(call);
    expect(d).not.toBeNull();
    expect(d!.orm).toBe("prisma");
    expect(d!.operation).toBe("read");
    expect(d!.target).toBe("user");
    expect(d!.awaited).toBe(true);
  });

  it("classifies create as a write", () => {
    const call = firstCall(`async function r(prisma){ await prisma.post.create({ data: {} }); }`, "prisma.post.create");
    expect(prismaAdapter(call)!.operation).toBe("write");
  });

  it("returns null for non-prisma calls", () => {
    const call = firstCall(`function r(){ console.log("x"); }`, "console.log");
    expect(prismaAdapter(call)).toBeNull();
  });

  it("returns null for a two-part call that is not model.method shaped", () => {
    const call = firstCall(`async function r(prisma){ await prisma.findMany(); }`, "prisma.findMany");
    expect(prismaAdapter(call)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/adapters/prisma.test.ts`
Expected: FAIL — module `../../src/adapters/prisma.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/adapters/prisma.ts`:
```ts
import { Node } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import { isInsideLoop } from "../loop.js";

const READ_METHODS = new Set(["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert"]);
const DELETE_METHODS = new Set(["delete", "deleteMany"]);

function operationFor(method: string): QueryDescriptor["operation"] {
  if (READ_METHODS.has(method)) return "read";
  if (WRITE_METHODS.has(method)) return "write";
  if (DELETE_METHODS.has(method)) return "delete";
  return "unknown";
}

const ALL_METHODS = new Set([...READ_METHODS, ...WRITE_METHODS, ...DELETE_METHODS]);

export function prismaAdapter(call: CallExpression): QueryDescriptor | null {
  const expr = call.getExpression();
  // Expect: <base>.<model>.<method>
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const method = expr.getName();
  if (!ALL_METHODS.has(method)) return null;

  const modelAccess = expr.getExpression();
  if (!Node.isPropertyAccessExpression(modelAccess)) return null;
  const model = modelAccess.getName();

  const base = modelAccess.getExpression();
  if (!Node.isIdentifier(base) && !Node.isPropertyAccessExpression(base)) return null;

  const isAwaited = Boolean(call.getFirstAncestor((a) => Node.isAwaitExpression(a)));

  return {
    db: "postgres",
    orm: "prisma",
    operation: operationFor(method),
    target: model,
    node: call,
    inLoop: isInsideLoop(call),
    awaited: isAwaited,
  };
}
```

`packages/core/src/index.ts` (append export):
```ts
export * from "./adapters/prisma.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/adapters/prisma.test.ts`
Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): add prisma adapter producing query descriptors"
```

---

### Task 6: `n-plus-one` rule

**Files:**
- Create: `packages/core/src/rules/n-plus-one.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/rules/n-plus-one.test.ts`

**Interfaces:**
- Consumes: `Rule`, `RuleContext`, `QueryDescriptor`, `makeDiagnostic` (Task 2).
- Produces: `const nPlusOneRule: Rule` with `id === "n-plus-one"`, `defaultSeverity === "error"`, emitting one diagnostic per descriptor whose `inLoop === true`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/rules/n-plus-one.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { nPlusOneRule } from "../../src/rules/n-plus-one.js";
import type { QueryDescriptor } from "../../src/types.js";

function descriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => prismaAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}

describe("nPlusOneRule", () => {
  it("flags a prisma query inside a loop", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma, ids){ for (const id of ids){ await prisma.user.findUnique({ where: { id } }); } }`) };
    const diags = nPlusOneRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("n-plus-one");
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message.toLowerCase()).toContain("loop");
  });

  it("does not flag a query outside a loop", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ await prisma.user.findMany(); }`) };
    expect(nPlusOneRule.match(ctx)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/rules/n-plus-one.test.ts`
Expected: FAIL — module `../../src/rules/n-plus-one.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/rules/n-plus-one.ts`:
```ts
import type { Rule } from "../types.js";
import { makeDiagnostic } from "../types.js";

export const nPlusOneRule: Rule = {
  id: "n-plus-one",
  defaultSeverity: "error",
  match(ctx) {
    return ctx.descriptors
      .filter((d) => d.inLoop)
      .map((d) =>
        makeDiagnostic({
          ruleId: "n-plus-one",
          severity: "error",
          message: `Query on "${d.target}" runs inside a loop (N+1). Batch it into a single query (e.g. a WHERE ... IN / findMany).`,
          node: d.node,
          docsUrl: "https://queryguard.dev/rules/n-plus-one",
        }),
      );
  },
};
```

`packages/core/src/index.ts` (append export):
```ts
export * from "./rules/n-plus-one.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/rules/n-plus-one.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): add n-plus-one rule"
```

---

### Task 7: Engine (`analyzeSource`)

**Files:**
- Create: `packages/core/src/engine.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/engine.test.ts`

**Interfaces:**
- Consumes: `parseSource`, `findCallExpressions`, `prismaAdapter`, `nPlusOneRule`, `Diagnostic`, `QueryDescriptor`.
- Produces: `function analyzeSource(code: string, filePath?: string): Diagnostic[]` — parses, runs all registered adapters to build descriptors, runs all registered rules, and returns merged diagnostics. Rule execution is wrapped in try/catch so a throwing rule is skipped, never fatal.

- [ ] **Step 1: Write the failing test**

`packages/core/test/engine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { analyzeSource } from "../src/engine.js";

describe("analyzeSource", () => {
  it("reports n-plus-one for a prisma query in a loop", () => {
    const diags = analyzeSource(`
      async function loadUsers(prisma, ids) {
        const users = [];
        for (const id of ids) {
          users.push(await prisma.user.findUnique({ where: { id } }));
        }
        return users;
      }
    `);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("n-plus-one");
  });

  it("reports nothing for a batched query", () => {
    const diags = analyzeSource(`
      async function loadUsers(prisma, ids) {
        return prisma.user.findMany({ where: { id: { in: ids } } });
      }
    `);
    expect(diags).toHaveLength(0);
  });

  it("does not throw on unparsable input", () => {
    expect(() => analyzeSource("const x = ")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/engine.test.ts`
Expected: FAIL — module `../src/engine.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/engine.ts`:
```ts
import { parseSource, findCallExpressions } from "./parse.js";
import { prismaAdapter } from "./adapters/prisma.js";
import { nPlusOneRule } from "./rules/n-plus-one.js";
import type { Diagnostic, QueryDescriptor, Rule } from "./types.js";
import type { CallExpression } from "ts-morph";

const adapters: Array<(call: CallExpression) => QueryDescriptor | null> = [prismaAdapter];
const rules: Rule[] = [nPlusOneRule];

export function analyzeSource(code: string, filePath?: string): Diagnostic[] {
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

  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    try {
      diagnostics.push(...rule.match({ descriptors }));
    } catch {
      // Best-effort: a throwing rule is skipped, never fatal.
    }
  }
  return diagnostics;
}
```

`packages/core/src/index.ts` (append export):
```ts
export * from "./engine.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/engine.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Run the whole core test suite**

Run: `cd packages/core && npx vitest run`
Expected: PASS — every test from Tasks 1–7 green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add analyzeSource engine wiring adapters and rules"
```

---

### Task 8: CLI (`@queryguard/cli`)

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/vitest.config.ts`
- Create: `packages/cli/src/run.ts`
- Create: `packages/cli/src/bin.ts`
- Test: `packages/cli/test/run.test.ts`
- Test fixtures: `packages/cli/test/fixtures/nplus1.ts`, `packages/cli/test/fixtures/clean.ts`

**Interfaces:**
- Consumes: `analyzeSource` (Task 7).
- Produces:
  - `async function run(patterns: string[], cwd: string): Promise<{ diagnostics: Array<Diagnostic & { file: string }>; errorCount: number }>`
  - `bin.ts` CLI entry that calls `run`, prints results, and exits `1` when `errorCount > 0`, else `0`.

- [ ] **Step 1: Create the CLI package files**

`packages/cli/package.json`:
```json
{
  "name": "@queryguard/cli",
  "version": "0.0.0",
  "type": "module",
  "bin": { "queryguard": "./dist/bin.js" },
  "scripts": {
    "test": "vitest run",
    "build": "tsup src/bin.ts --format esm",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@queryguard/core": "workspace:*",
    "fast-glob": "^3.3.0"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/cli/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

`packages/cli/test/fixtures/nplus1.ts`:
```ts
export async function loadUsers(prisma: any, ids: string[]) {
  const users = [];
  for (const id of ids) {
    users.push(await prisma.user.findUnique({ where: { id } }));
  }
  return users;
}
```

`packages/cli/test/fixtures/clean.ts`:
```ts
export async function loadUsers(prisma: any, ids: string[]) {
  return prisma.user.findMany({ where: { id: { in: ids } } });
}
```

- [ ] **Step 2: Install the new workspace dependency**

Run: `cd /Users/anujchhikara/anuj/projects/queryguard && pnpm install`
Expected: `fast-glob` installed; `@queryguard/core` linked into the cli package via `workspace:*`.

- [ ] **Step 3: Write the failing test**

`packages/cli/test/run.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run } from "../src/run.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

describe("run", () => {
  it("finds n-plus-one in the fixture and reports an error count", async () => {
    const result = await run(["nplus1.ts"], fixtures);
    expect(result.errorCount).toBe(1);
    expect(result.diagnostics[0].ruleId).toBe("n-plus-one");
    expect(result.diagnostics[0].file).toContain("nplus1.ts");
  });

  it("reports zero for clean code", async () => {
    const result = await run(["clean.ts"], fixtures);
    expect(result.errorCount).toBe(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/run.test.ts`
Expected: FAIL — module `../src/run.js` not found.

- [ ] **Step 5: Write minimal implementation**

`packages/cli/src/run.ts`:
```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";
import { analyzeSource } from "@queryguard/core";
import type { Diagnostic } from "@queryguard/core";

export interface FileDiagnostic extends Diagnostic {
  file: string;
}

export async function run(
  patterns: string[],
  cwd: string,
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
    for (const diag of analyzeSource(code, abs)) {
      diagnostics.push({ ...diag, file });
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  return { diagnostics, errorCount };
}
```

`packages/cli/src/bin.ts`:
```ts
#!/usr/bin/env node
import { run } from "./run.js";

async function main() {
  const patterns = process.argv.slice(2);
  if (patterns.length === 0) {
    console.error("usage: queryguard <glob> [glob...]");
    process.exit(2);
  }

  const { diagnostics, errorCount } = await run(patterns, process.cwd());

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

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run test/run.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 7: Build and smoke-test the real binary**

Run:
```bash
cd /Users/anujchhikara/anuj/projects/queryguard && pnpm -r build
cd packages/cli && node dist/bin.js "test/fixtures/nplus1.ts"
```
Expected: prints one `n-plus-one` line for `nplus1.ts` and exits with code 1 (`echo $?` → `1`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(cli): add queryguard CLI wrapping the core engine"
```

---

## Self-Review

**Spec coverage (Plan 1's slice only):**
- Core engine + adapter + rule + `QueryDescriptor` (spec §3, §4) → Tasks 2–7. ✓
- Static, no network/LLM (spec §2) → engine has no such calls. ✓
- CLI/CI surface (spec §3) → Task 8, non-zero exit for CI gating. ✓
- Precision-first, best-effort resilience (spec §1, §7) → engine try/catch (Task 7), adapter returns null when unsure (Task 5), parse doesn't throw (Task 3). ✓
- Tiers 2/3, Firestore, LSP/VS Code, other packs → intentionally deferred to Plans 2–6. ✓ (out of this plan's scope)

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". All code blocks are final (Task 5's `awaited` computation is a single clean `isAwaited` line). ✓

**Type consistency:** `Diagnostic`, `QueryDescriptor`, `Rule`, `RuleContext`, `makeDiagnostic` defined in Task 2 and used unchanged in Tasks 5–8. `analyzeSource(code, filePath?)` defined in Task 7, consumed in Task 8. `run(patterns, cwd)` defined and consumed in Task 8. `prismaAdapter`/`nPlusOneRule` names consistent across Tasks 5–7. ✓
