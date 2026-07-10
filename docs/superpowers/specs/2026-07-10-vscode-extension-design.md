# QueryGuard — VS Code Extension (Minimal) — Design Spec

**Date:** 2026-07-10
**Status:** Approved design, pending implementation plan
**Relates to:** [QueryGuard Design Spec](2026-07-10-queryguard-design.md) (§3 components: `@queryguard/vscode`)

---

## 1. Problem & Purpose

Today QueryGuard is only usable from the CLI. Its differentiator — flagging bad
DB access **as you type** — is invisible until it lives in the editor. This
project builds the first, minimal `@queryguard/vscode` extension: run the
existing engine on the active file, live, and show squiggles. It is deliberately
small — one rule, no config, no hovers — enough to install and *feel* the product.

**Explicit non-goal for this slice:** the LSP/language-server architecture the
top-level spec envisions. We run the engine **in-process** now and can extract an
LSP later. This is a pragmatic first slice, not the final architecture.

---

## 2. Scope

### In scope
- A new `packages/vscode` package in the monorepo.
- In-process use of `@queryguard/core`'s `analyzeSource` on the active document.
- Live analysis **as you type**, debounced (~300ms).
- Publishing VS Code diagnostics (squiggles) for the existing `n-plus-one` rule.
- Bundling to a single `dist/extension.js` and packaging an installable `.vsix`.
- Unit tests (vitest) on the pure mapping layer.

### Out of scope (YAGNI — later slices)
- Hover explanations, quick-fixes/code actions, configuration/settings.
- LSP / language server / editor-agnostic client.
- New rules or adapters (uses only what core already ships).
- Extension-host integration tests (`@vscode/test-electron`); manual `.vsix`
  install is the acceptance path for the glue.

### Constraints
- Best-effort analysis (top-level spec §7): a parse error on a mid-typing file
  MUST never throw, show a popup, or break the editor — it yields zero diagnostics.
- `vscode` is a host-provided module: it is `external` in the bundle and a
  `devDependency` only.

---

## 3. Architecture

`packages/vscode` is a standard VS Code extension. On activation it registers
document listeners, and on each (debounced) change it runs the engine in-process
and writes results into a single `DiagnosticCollection`. The extension is bundled
with tsup/esbuild into one `dist/extension.js` with `@queryguard/core` inlined and
`vscode` marked external, so the packaged `.vsix` carries no `node_modules`.

```
packages/vscode/
  package.json            # extension manifest + build/package scripts
  tsup.config.ts          # bundle: entry src/extension.ts, format cjs, external vscode
  src/
    extension.ts          # activate()/deactivate(): listeners, debounce, DiagnosticCollection, offset->Position
    analyze.ts            # PURE: toVsDiagnostics(code, fileName) -> MappedDiagnostic[]  (no runtime vscode import)
  test/
    analyze.test.ts       # vitest unit tests for toVsDiagnostics
  tsconfig.json
  vitest.config.ts
```

---

## 4. Components & Interfaces

### `src/analyze.ts` (pure, unit-testable)

```ts
export interface MappedDiagnostic {
  startOffset: number;               // core Diagnostic.range.start (absolute char offset)
  endOffset: number;                 // core Diagnostic.range.end
  severity: "error" | "warning" | "info";  // core Diagnostic.severity, passed through
  ruleId: string;
  message: string;
}

export function toVsDiagnostics(code: string, fileName: string): MappedDiagnostic[];
```

- Calls `analyzeSource(code, fileName)` from `@queryguard/core`.
- Maps each core `Diagnostic` to `MappedDiagnostic`, carrying **absolute offsets**
  (`range.start`/`range.end`) — not line/column.
- Wrapped in try/catch; returns `[]` on any thrown error.
- Imports from `vscode` are forbidden here (keeps it runnable under vitest).

### `src/extension.ts` (host glue)

- Owns one `vscode.DiagnosticCollection` named `queryguard`.
- `analyzeDocument(doc)`: skips non-TS/JS languages; calls `toVsDiagnostics(doc.getText(), doc.fileName)`; converts each `MappedDiagnostic` to a `vscode.Diagnostic` using **`doc.positionAt(startOffset)` / `doc.positionAt(endOffset)`** for an exact `Range` (avoids all 1-based/0-based math), and maps severity: `error → Error`, `warning → Warning`, `info → Information`; sets the collection for `doc.uri`.
- Listeners: `onDidChangeTextDocument` (debounced ~300ms per URI), `onDidOpenTextDocument`, `onDidCloseTextDocument` (clear that URI). Analyze the active editor's document on activation.
- All registered disposables pushed to `context.subscriptions`.

### `package.json` manifest (key fields)

- `main`: `./dist/extension.js`
- `engines.vscode`: `^1.85.0`
- `activationEvents`: `onLanguage:typescript`, `onLanguage:javascript`,
  `onLanguage:typescriptreact`, `onLanguage:javascriptreact`
- `contributes`: none required for this slice.
- Scripts: `build` (tsup), `package` (`vsce package`), `test` (vitest).
- `devDependencies`: `@types/vscode`, `@vscode/vsce`, `tsup`, `typescript`, `vitest`.
- `dependencies`: `@queryguard/core` (`workspace:*`) — inlined at bundle time.

---

## 5. Data Flow

Open/edit a `.ts`/`.js`/`.tsx`/`.jsx` file → debounce (~300ms) →
`toVsDiagnostics(text, path)` → for each result, `positionAt` both offsets → build
`vscode.Diagnostic` → `collection.set(uri, diags)` → squiggles appear.
Close file → `collection.delete(uri)`.

---

## 6. Error Handling

- `toVsDiagnostics` never throws — try/catch returns `[]`. Mid-typing/unparsable
  files simply show no squiggles.
- Non-target languages are ignored (guarded by `languageId` before analysis).

---

## 7. Testing

- **Automated (vitest, no editor needed)** on `toVsDiagnostics`:
  - N+1 snippet → exactly one `MappedDiagnostic`, `ruleId === "n-plus-one"`,
    `severity === "error"`, offsets within the code length.
  - Clean snippet (`findMany({ include })`) → `[]`.
  - Malformed/half-typed code → `[]` (never throws).
- **Manual acceptance (the install path):**
  1. `pnpm --filter @queryguard/vscode build`
  2. `pnpm --filter @queryguard/vscode package` → `queryguard-<version>.vsix`
  3. `code --install-extension packages/vscode/queryguard-*.vsix`
  4. Open a file containing an N+1 loop → a red squiggle with the `n-plus-one`
     message appears live as you type; the fixed version clears it.

---

## 8. Success Criteria

- A `.vsix` builds from the monorepo and installs into VS Code.
- Typing an N+1 loop in a TS file shows a live squiggle within ~300ms; fixing it
  clears the squiggle.
- The pure mapping layer is covered by passing vitest tests.
- A malformed file never throws or disrupts the editor.

---

## 9. Risks

- **Bundling workspace dep:** `@queryguard/core` must be inlined by tsup (not left
  as an external `require`), or the `.vsix` breaks at runtime. Mitigation: tsup
  bundles by default; only `vscode` is marked external. Verified by installing the
  `.vsix`, not just building it.
- **`ts-morph` bundle size:** the engine pulls in TypeScript; the `.vsix` will be
  a few MB. Acceptable for a dev tool; note it, don't optimize yet.
- **Debounce correctness:** per-URI timers must be cleared on dispose to avoid
  analyzing closed documents.
