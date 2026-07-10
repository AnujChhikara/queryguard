# VS Code Extension (Minimal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a minimal `queryguard-vscode` extension that runs `@queryguard/core` in-process, shows live N+1 squiggles as you type, and packages as an installable `.vsix`.

**Architecture:** New `packages/vscode` package. A pure `analyze.ts` maps core `Diagnostic`s (absolute char offsets) into a neutral `MappedDiagnostic[]` (unit-testable, no `vscode` import). `extension.ts` glues it to VS Code: debounced document listeners, `document.positionAt()` for exact ranges, one `DiagnosticCollection`. Bundled to a single CJS `dist/extension.js` with `vscode` external, then packaged with `@vscode/vsce`.

**Tech Stack:** TypeScript, VS Code Extension API, tsup (bundle), vitest (unit tests), @vscode/vsce (packaging).

**Spec:** `docs/superpowers/specs/2026-07-10-vscode-extension-design.md`

## Global Constraints

- Extension name is **unscoped** (`queryguard-vscode`) — `@vscode/vsce` rejects scoped names. This deviates from the `@queryguard/*` convention on purpose.
- The extension bundle is **CommonJS**; `vscode` is `external` (host-provided) and a `devDependency` only.
- `@queryguard/core` is a `workspace:*` dependency and MUST be inlined by tsup (never left as an external require) or the `.vsix` breaks at runtime.
- Best-effort analysis: `toVsDiagnostics` MUST NOT throw — it returns `[]` on any error (mid-typing files never disrupt the editor).
- Map offsets, not line/column: use core `range.start`/`range.end` with `document.positionAt()`. Severity map: `error → Error`, `warning → Warning`, `info → Information`.
- Debounce ~300ms per document URI; clear timers on close/dispose.
- Target languages only: `typescript`, `javascript`, `typescriptreact`, `javascriptreact`.
- Scope guard (YAGNI): no hovers, no quick-fixes, no config, no LSP.

---

### Task 1: Scaffold package + pure `analyze.ts` (TDD)

**Files:**
- Create: `packages/vscode/package.json`
- Create: `packages/vscode/tsconfig.json`
- Create: `packages/vscode/vitest.config.ts`
- Create: `packages/vscode/src/analyze.ts`
- Test: `packages/vscode/test/analyze.test.ts`

**Interfaces:**
- Consumes: `analyzeSource(code: string, fileName: string): Diagnostic[]` and the `Diagnostic` type from `@queryguard/core` (fields: `ruleId`, `severity: "error"|"warning"|"info"`, `message`, `range: { start, end, line, column }`).
- Produces: `toVsDiagnostics(code: string, fileName: string): MappedDiagnostic[]` where `MappedDiagnostic = { startOffset: number; endOffset: number; severity: "error"|"warning"|"info"; ruleId: string; message: string }`.

- [ ] **Step 1: Create `packages/vscode/package.json`**

```json
{
  "name": "queryguard-vscode",
  "displayName": "QueryGuard",
  "description": "Flags inefficient database access (N+1 queries) in TypeScript/JavaScript as you type.",
  "version": "0.0.0",
  "publisher": "anujchhikara",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/AnujChhikara/queryguard" },
  "engines": { "vscode": "^1.85.0" },
  "main": "./dist/extension.js",
  "activationEvents": [
    "onLanguage:typescript",
    "onLanguage:javascript",
    "onLanguage:typescriptreact",
    "onLanguage:javascriptreact"
  ],
  "contributes": {},
  "scripts": {
    "build": "tsup",
    "package": "tsup && vsce package --no-dependencies -o queryguard.vsix",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@queryguard/core": "workspace:*"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.24.0",
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/vscode/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "types": ["vscode"] },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/vscode/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 4: Install deps and build core (so the workspace import resolves)**

Run:
```bash
pnpm install
pnpm --filter @queryguard/core build
```
Expected: install completes; core `dist/` is present.

- [ ] **Step 5: Write the failing test `packages/vscode/test/analyze.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toVsDiagnostics } from "../src/analyze.js";

const N_PLUS_ONE = `
const users = await prisma.user.findMany()
for (const user of users) {
  const posts = await prisma.post.findMany({ where: { authorId: user.id } })
}
`;

const CLEAN = `const users = await prisma.user.findMany({ include: { posts: true } })`;
const BROKEN = "const = = = @@@ (";

describe("toVsDiagnostics", () => {
  it("flags an N+1 loop with one error diagnostic", () => {
    const diags = toVsDiagnostics(N_PLUS_ONE, "bad.ts");
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("n-plus-one");
    expect(diags[0].severity).toBe("error");
    expect(diags[0].startOffset).toBeGreaterThanOrEqual(0);
    expect(diags[0].endOffset).toBeGreaterThan(diags[0].startOffset);
    expect(diags[0].endOffset).toBeLessThanOrEqual(N_PLUS_ONE.length);
  });

  it("returns no diagnostics for a clean single query", () => {
    expect(toVsDiagnostics(CLEAN, "good.ts")).toEqual([]);
  });

  it("returns [] for malformed code instead of throwing", () => {
    expect(() => toVsDiagnostics(BROKEN, "broken.ts")).not.toThrow();
    expect(toVsDiagnostics(BROKEN, "broken.ts")).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter queryguard-vscode test`
Expected: FAIL — cannot resolve `../src/analyze.js` (module not found).

- [ ] **Step 7: Implement `packages/vscode/src/analyze.ts`**

```ts
import { analyzeSource, type Diagnostic } from "@queryguard/core";

export interface MappedDiagnostic {
  startOffset: number;
  endOffset: number;
  severity: "error" | "warning" | "info";
  ruleId: string;
  message: string;
}

/**
 * Runs the QueryGuard engine on a source string and maps each diagnostic to a
 * neutral, editor-agnostic shape carrying absolute character offsets.
 * Best-effort: never throws — returns [] on any engine error.
 */
export function toVsDiagnostics(code: string, fileName: string): MappedDiagnostic[] {
  let diagnostics: Diagnostic[];
  try {
    diagnostics = analyzeSource(code, fileName);
  } catch {
    return [];
  }
  return diagnostics.map((d) => ({
    startOffset: d.range.start,
    endOffset: d.range.end,
    severity: d.severity,
    ruleId: d.ruleId,
    message: d.message,
  }));
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter queryguard-vscode test`
Expected: PASS — 3 tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/vscode/package.json packages/vscode/tsconfig.json packages/vscode/vitest.config.ts packages/vscode/src/analyze.ts packages/vscode/test/analyze.test.ts pnpm-lock.yaml
git commit -m "feat(vscode): add pure analyze mapping layer with tests"
```

---

### Task 2: Extension host glue + CJS bundle

**Files:**
- Create: `packages/vscode/src/extension.ts`
- Create: `packages/vscode/tsup.config.ts`

**Interfaces:**
- Consumes: `toVsDiagnostics(code, fileName): MappedDiagnostic[]` from `./analyze.js` (Task 1).
- Produces: `activate(context: vscode.ExtensionContext): void` and `deactivate(): void`, bundled to `dist/extension.js` (CommonJS).

- [ ] **Step 1: Create `packages/vscode/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  external: ["vscode"],
  outDir: "dist",
  clean: true,
});
```

- [ ] **Step 2: Create `packages/vscode/src/extension.ts`**

```ts
import * as vscode from "vscode";
import { toVsDiagnostics, type MappedDiagnostic } from "./analyze.js";

const TARGET_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
]);

const DEBOUNCE_MS = 300;

function toSeverity(s: MappedDiagnostic["severity"]): vscode.DiagnosticSeverity {
  if (s === "error") return vscode.DiagnosticSeverity.Error;
  if (s === "warning") return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("queryguard");
  context.subscriptions.push(collection);

  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function analyzeDocument(doc: vscode.TextDocument): void {
    if (!TARGET_LANGUAGES.has(doc.languageId)) return;
    const mapped = toVsDiagnostics(doc.getText(), doc.fileName);
    const diags = mapped.map((m) => {
      const range = new vscode.Range(
        doc.positionAt(m.startOffset),
        doc.positionAt(m.endOffset),
      );
      const diag = new vscode.Diagnostic(range, m.message, toSeverity(m.severity));
      diag.source = "queryguard";
      diag.code = m.ruleId;
      return diag;
    });
    collection.set(doc.uri, diags);
  }

  function scheduleAnalyze(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        analyzeDocument(doc);
      }, DEBOUNCE_MS),
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => scheduleAnalyze(e.document)),
    vscode.workspace.onDidOpenTextDocument((doc) => analyzeDocument(doc)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const existing = timers.get(key);
      if (existing) {
        clearTimeout(existing);
        timers.delete(key);
      }
      collection.delete(doc.uri);
    }),
  );

  if (vscode.window.activeTextEditor) {
    analyzeDocument(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push({
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  });
}

export function deactivate(): void {
  // Listeners and the DiagnosticCollection are disposed via context.subscriptions.
}
```

- [ ] **Step 3: Build the bundle**

Run: `pnpm --filter queryguard-vscode build`
Expected: PASS — writes `packages/vscode/dist/extension.js`, no errors.

- [ ] **Step 4: Verify the bundle is CJS, exports activate, and inlined core (no external require of @queryguard/core)**

Run:
```bash
node -e "const s=require('fs').readFileSync('packages/vscode/dist/extension.js','utf8');if(!/exports\.activate/.test(s)){console.error('no activate export');process.exit(1)}if(/require\(['\"]@queryguard\/core['\"]\)/.test(s)){console.error('core NOT inlined');process.exit(1)}if(!/require\(['\"]vscode['\"]\)/.test(s)){console.error('vscode should stay external');process.exit(1)}console.log('bundle OK: activate exported, core inlined, vscode external')"
```
Expected: `bundle OK: activate exported, core inlined, vscode external`

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter queryguard-vscode typecheck`
Expected: PASS — no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode/src/extension.ts packages/vscode/tsup.config.ts
git commit -m "feat(vscode): add extension host glue with debounced diagnostics"
```

---

### Task 3: Package the `.vsix` + manual test instructions

**Files:**
- Create: `packages/vscode/README.md`
- Create: `packages/vscode/.vscodeignore`

**Interfaces:**
- Consumes: `dist/extension.js` from Task 2 and the `package` script from Task 1.
- Produces: `packages/vscode/queryguard.vsix` (installable).

- [ ] **Step 1: Create `packages/vscode/README.md`**

```markdown
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
```

- [ ] **Step 2: Create `packages/vscode/.vscodeignore`** (keep the `.vsix` small — ship only the bundle)

```
src/**
test/**
tsconfig.json
tsup.config.ts
vitest.config.ts
**/*.map
node_modules/**
```

- [ ] **Step 3: Build and package the extension**

Run: `pnpm --filter queryguard-vscode package`
Expected: PASS — tsup builds, then vsce writes `packages/vscode/queryguard.vsix`. Warnings (e.g. no icon) are acceptable; there must be no ERROR.

- [ ] **Step 4: Verify the `.vsix` exists and is non-trivial (core is bundled in)**

Run:
```bash
node -e "const fs=require('fs');const p='packages/vscode/queryguard.vsix';const b=fs.statSync(p).size;if(b<50000){console.error('vsix too small, core may not be bundled:',b);process.exit(1)}console.log('vsix OK:',b,'bytes')"
```
Expected: `vsix OK: <size> bytes` (expect a few hundred KB to a few MB — it embeds the TS-based engine).

- [ ] **Step 5: Add the `.vsix` to `.gitignore` (build artifact, not source)**

Append to the repo-root `.gitignore`:
```
packages/vscode/*.vsix
```

Run:
```bash
node -e "const fs=require('fs');const p='.gitignore';const t=fs.readFileSync(p,'utf8');if(!t.includes('packages/vscode/*.vsix')){fs.appendFileSync(p, (t.endsWith('\n')?'':'\n')+'packages/vscode/*.vsix\n')}console.log('gitignore updated')"
```
Expected: `gitignore updated`

- [ ] **Step 6: Manual acceptance test (cannot be automated — the squiggle is visual)**

Do this by hand and confirm:
```bash
code --install-extension packages/vscode/queryguard.vsix
```
Then in VS Code:
1. Create `scratch.ts` with:
   ```ts
   const users = await prisma.user.findMany()
   for (const user of users) {
     const posts = await prisma.post.findMany({ where: { authorId: user.id } })
   }
   ```
2. Confirm a red squiggle appears on the inner `findMany` within ~300ms, with the
   message "Query on \"post\" runs inside a loop (N+1)..." and source `queryguard`.
3. Replace the body with `const users = await prisma.user.findMany({ include: { posts: true } })`
   and confirm the squiggle clears.
4. Type obviously broken syntax and confirm the editor is never disrupted (no crash, no popup).

- [ ] **Step 7: Commit**

```bash
git add packages/vscode/README.md packages/vscode/.vscodeignore .gitignore
git commit -m "feat(vscode): package extension as installable vsix + docs"
```

---

## Self-Review

**Spec coverage:**
- §2 new `packages/vscode`, in-process core, debounced as-you-type, squiggles, `.vsix`, unit tests → Tasks 1–3. ✓
- §3 file structure (`extension.ts`, `analyze.ts`, `package.json`, `tsup.config.ts`, tests) → Tasks 1–2. ✓
- §4 `MappedDiagnostic` shape + `toVsDiagnostics` signature → Task 1 Step 7. ✓
- §4 `extension.ts` behavior (collection, positionAt, severity map, listeners, debounce, subscriptions) → Task 2 Step 2. ✓
- §4 manifest fields (main, engines.vscode, activationEvents, scripts, deps) → Task 1 Step 1. ✓
- §5 data flow (open/edit → debounce → positionAt → set; close → delete) → Task 2 Step 2. ✓
- §6 error handling (try/catch → []; language guard) → Task 1 Step 7 + Task 2 Step 2. ✓
- §7 automated tests (N+1 → 1, clean → [], malformed → []) → Task 1 Step 5; manual `.vsix` acceptance → Task 3 Step 6. ✓
- §8 success criteria (vsix builds/installs; live squiggle; mapper tested; no disruption) → Task 3 Steps 3–6. ✓
- §9 risks (core inlined; vsix size) → verified in Task 2 Step 4 + Task 3 Step 4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code and command step is concrete.

**Type consistency:** `MappedDiagnostic` fields (`startOffset`, `endOffset`, `severity`, `ruleId`, `message`) are identical in Task 1 (definition + test) and Task 2 (consumption via `MappedDiagnostic["severity"]` and `m.startOffset`/`m.endOffset`). `toVsDiagnostics(code, fileName)` signature matches across Task 1 and Task 2. Package name `queryguard-vscode` is used consistently in all `pnpm --filter` commands.
