# VS Code Suppression Quick-Fix — Design Spec

_Date: 2026-07-12._

## 1. Goal

Bring the `cardinal suppress` flow into the editor as a lightbulb **quick-fix**,
so suppressing a finding no longer requires dropping to the CLI. Full parity with
the CLI: optional reason, plus the optional cardinality-fact promotion.

## 2. Architecture

Follows the existing extension split (pure/testable core logic + thin vscode
glue), mirroring `analyze.ts` and `knowledge-cache.ts`.

### 2.1 `packages/vscode/src/suppress-action.ts` — pure, no vscode import

```ts
interface SuppressIO {
  askReason: () => Promise<string | undefined>;        // undefined = cancelled
  confirmFact: (table: string, rows: number) => Promise<boolean>;
}

async function performSuppression(
  params: { code: string; absPath: string; relPath: string; line: number; ruleId: string; workspaceRoot?: string },
  io: SuppressIO,
): Promise<{ ok: true; message: string; knowledgeFile: string } | { ok: false; error: string }>;
```

Behavior:
1. `discoverKnowledge(dirname(absPath))` → knowledge (for the fact suggestion).
2. `buildSuppressPlan(code, relPath, line, ruleId, knowledge)` (core). On
   `{ error }`, return `{ ok: false, error }`.
3. `askReason()`. If it resolves `undefined` (user cancelled), abort with no write
   (`{ ok: false, error: "cancelled" }`).
4. Resolve the target file (`resolveKnowledgeFilePath`): the existing discovered
   `cardinal.knowledge.{yaml,yml,json}`, else `<workspaceRoot ?? dirname(absPath)>/cardinal.knowledge.yaml`.
5. `addSuppression(file, { ...plan.suppression, reason })` (core).
6. If `plan.suggestedFact` and `await confirmFact(table, rows)` →
   `addFact(file, table, rows)` (core).
7. Return `{ ok: true, message, knowledgeFile }`.

`code` is the editor buffer text (passed by the caller), so **unsaved edits are
respected**.

### 2.2 `packages/vscode/src/extension.ts` — glue

- A `CodeActionProvider` registered for the four target languages, advertising
  `CodeActionKind.QuickFix`. `provideCodeActions` filters `context.diagnostics`
  to `diag.source === "cardinal"` and, for each, returns a `QuickFix` titled
  `Suppress "<ruleId>" (Cardinal)` whose `.command` invokes the internal command
  `cardinal.suppress` with `{ uri, ruleId, line }` (ruleId from `diag.code`,
  line from the diagnostic range).
- An internal command `cardinal.suppress` (registered via `registerCommand`, not
  contributed to the palette): resolves the `TextDocument`, computes `relPath`
  via `vscode.workspace.asRelativePath`, builds `SuppressIO` from vscode
  (`showInputBox` for the reason; a `showInformationMessage(..., "Record", "Skip")`
  for the fact), calls `performSuppression`, then:
  - success → `showInformationMessage(message)` and call the existing
    `refreshKnowledge()` (clear cache + re-lint) so the squiggle clears at once;
  - `error === "cancelled"` → do nothing;
  - other error → `showWarningMessage(error)`.

The knowledge-file watcher already re-lints on write; the direct
`refreshKnowledge()` call just guarantees immediacy.

## 3. Data flow

diagnostic → 💡 quick-fix → `cardinal.suppress` → `performSuppression` → core
`buildSuppressPlan` / `addSuppression` / `addFact` → `cardinal.knowledge.yaml`
written → cache cleared + re-lint → diagnostic gone.

## 4. Edge cases

- Reason cancelled (Esc) → abort, nothing written.
- No workspace folder → write beside the file; `relPath` falls back to the
  absolute path (matching is by basename in v1, so this still works).
- `buildSuppressPlan` returns an error → surfaced via `showWarningMessage`.
- Multiple diagnostics on one line → the exact `ruleId` is passed, so
  `buildSuppressPlan` resolves a single finding.

## 5. Testing

`packages/vscode/test/suppress-action.test.ts` (vitest, temp dir, real core,
injected callbacks):
- records a suppression with a reason into a fresh knowledge file (verified via
  `parseKnowledge`);
- records the fact when `confirmFact` returns true, and not when false;
- aborts on cancelled reason (no file created);
- reuses an existing discovered knowledge file rather than creating a new one.

The `CodeActionProvider`/command glue in `extension.ts` is verified by build plus
a manual smoke check, consistent with how the extension host code is treated
today.

## 6. Out of scope

- A "suppress without reason" second action (one action that prompts is enough).
- Palette-invokable suppression (needs diagnostic context; quick-fix only).
- Comment-preserving YAML writes (core limitation, tracked separately).
