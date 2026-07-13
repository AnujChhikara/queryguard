# Cardinal JSON output (`--format json`) — design

## Problem

Cardinal's expertise is knowing **what** is wrong with a data-access pattern and
**why it matters at your data's scale**. It should not rewrite code (brittle,
and it would break the "100% static, offline" promise). But an AI coding agent
*can* apply the fix — if it is handed the context it cannot infer from source
alone: the anti-pattern, the canonical fix, and the cardinality reasoning from
the knowledge file.

Today the CLI only emits human-readable lines. This adds a machine-readable
output so an agent (Claude Code, Cursor, Copilot) — or a CI bot — can consume
each finding with enough context to fix it.

## Division of labor

- **Cardinal** = the static, context-aware detective. Finds it, explains why it
  matters at scale, prescribes the fix. No LLM, stays offline.
- **The AI agent** = the surgeon. Reads Cardinal's JSON, applies the edit.

The moat is the **cardinality context**: the one thing the agent is blind to and
Cardinal knows from the knowledge file.

## Design

Two pieces. **No changes to the analysis engine or the `Diagnostic` type** — the
finding's specifics (target, cardinality) already live in `Diagnostic.message`.

### 1. Rule explanations (`packages/core`)

A static table mapping each rule id to a reusable `{ why, fix }`:

```ts
export interface RuleExplanation { why: string; fix: string; }
export const ruleExplanations: Record<string, RuleExplanation> = { /* ... */ };
export function explainRule(ruleId: string): RuleExplanation | undefined;
```

Lives in `src/rules/explanations.ts`, exported from the core index. Placed in
core (not the CLI) so the VS Code extension can reuse the same copy for hover
cards later. `why`/`fix` are generic per rule, authored once.

**Invariant:** every rule registered in the engine has an explanation. A test
enforces this against the engine's rule list.

### 2. `--format json` + JSON formatter (`packages/cli`)

- New flag `--format <text|json>`, default `text` (current behavior unchanged).
- New `src/format.ts` exporting `formatJson(diagnostics, errorCount): string`.
- `bin.ts`: when `format === "json"`, print `formatJson(...)`; else the existing
  text lines. Exit code is unchanged (1 iff any error-severity diagnostic).

Output shape (stdout, pretty-printed):

```jsonc
{
  "tool": "cardinal",
  "version": 1,
  "summary": { "problems": 3, "errors": 1 },
  "findings": [
    {
      "ruleId": "n-plus-one",
      "severity": "error",
      "file": "src/orders.ts",
      "line": 12,
      "column": 8,
      "message": "Query on \"post\" runs once per row of ~10000-row set (N+1 amplified)...",
      "docsUrl": "https://github.com/AnujChhikara/cardinal#n-plus-one",
      "explanation": {
        "why": "A query awaited inside a loop runs once per iteration — 1 + N round trips.",
        "fix": "Collect the loop's keys and run one batched query (WHERE ... IN / findMany), then group in memory."
      }
    }
  ]
}
```

Notes:
- `message` carries the per-finding specifics; `explanation` carries the
  reusable why/fix. An agent gets everything from one object.
- Cardinal's status notices ("using knowledge from…") already go to **stderr**,
  so stdout stays pure, parseable JSON.
- A finding whose `ruleId` has no explanation simply omits the `explanation`
  field (the invariant test prevents this for shipped rules).

## Scope (YAGNI)

Only `text` and `json` formats. No SARIF, no config-file knob for output format.
Both are easy to add later if a user asks.

## Testing

- **core:** `ruleExplanations` has a non-empty `why` and `fix` for every rule in
  the engine's rule list; `explainRule` returns them / `undefined` for unknown.
- **cli:** `formatJson` produces valid JSON with the wrapper, correct
  `summary` counts, per-finding fields, and an attached `explanation`; unknown
  rule ids omit `explanation`; empty input yields an empty `findings` array.
- **cli (wiring):** `--format json` path prints JSON; default path unchanged.
