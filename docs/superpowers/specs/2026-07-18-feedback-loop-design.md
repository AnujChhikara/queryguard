# Feedback Loop: One-Click Reports + Public Corpus — Design

**Date:** 2026-07-18
**Status:** approved (brainstormed with Anuj)

## Goal

Users who hit a wrong result can report it in one click; every confirmed report
becomes a permanent test case; the website says Cardinal is continuously tuned
by these reports. All of it stays inside the existing positioning: 100% static,
no LLM, nothing leaves the user's machine except what they explicitly post on
GitHub.

## Explicitly out of scope

- No backend, no website form, no telemetry, no automatic upload of any kind.
- No ML/trained model. The "learning loop" is a deterministic, public corpus of
  regression tests. (Discussed and agreed: an in-product model would undercut
  the "static, no LLM" promise that is Cardinal's differentiation.)

## Components

### 1. GitHub issue templates

`.github/ISSUE_TEMPLATE/` gains three YAML forms (plus `config.yml` disabling
blank issues is NOT desired — blank issues stay allowed):

- `false-positive.yml` — "Cardinal flagged this, but it's fine."
  Fields: rule id (dropdown of the seven rules), the flagged code snippet
  (textarea, rendered as ts), the diagnostic message (input), why it's wrong
  (textarea), Cardinal version + adapter (input).
- `missed-catch.yml` — "This query is slow; Cardinal stayed quiet."
  Fields: code snippet, what should have been flagged (textarea), which
  ORM/adapter, version.
- `crash.yml` — "CLI/extension errored."
  Fields: command run, error output, minimal code if known, version.

Labels: templates auto-apply `false-positive` / `missed-catch` / `crash` plus
`corpus-candidate`.

### 2. One-click report at suppress time

Suppression is the moment a user tells us a finding is wrong — hook there.

- **Shared helper (cardinal-core):** `buildReportUrl(input)` in
  `packages/core/src/report.ts`, exported from the package index.
  Input: `{ rule: string; message: string; anchor: string; version?: string }`.
  Output: a `https://github.com/AnujChhikara/cardinal/issues/new?...` URL with
  `template=false-positive.yml`, a prefilled title
  (`[false-positive] <rule>: <anchor truncated to ~60 chars>`), and prefilled
  body fields via the issue-forms query params. URL-encoding handled here;
  total URL capped (~6KB) by truncating the anchor/message, never erroring.
  The anchor (normalized call text) is already computed by the suppression
  flow — no new code extraction.
- **CLI:** after `cardinal suppress` succeeds, print to stderr:
  `Think Cardinal got this wrong? Report it (pre-filled): <url>`.
- **VS Code:** after the suppress quick-fix succeeds, the existing success
  toast gains a second button `Report as false positive` which opens the same
  URL via `vscode.env.openExternal`.

The user always lands on GitHub with the issue visible before pressing
"Create" — explicit consent, nothing sent automatically.

### 3. The corpus (the learning loop)

- Confirmed reports become fixtures in `packages/core/test/corpus/`, one vitest
  file per case, named `<kind>-<issue#>-<slug>.test.ts`
  (e.g. `fp-123-graphql-query-verb.test.ts`). Each file embeds the reported
  snippet inline and asserts the *correct* verdict via `analyzeSource`.
- Conversion is manual (maintainer or contributor turns an issue into a test in
  the fixing PR) — no automation infra for now (YAGNI).
- `README.md` gains a short "Reporting a wrong finding" section documenting the
  templates, the suppress-time link, and the rule: **every confirmed report
  ships as a permanent regression test**, so a fixed false positive can never
  return. Release notes may cite "tuned by N real-world reports."
- The existing `test/false-positives.test.ts` stays; new cases go to corpus/.

### 4. Website messaging

- Roadmap section: add one line under the title — "Cardinal is tuned by real
  codebases: every wrong finding you report becomes a permanent test." with a
  link to the false-positive template.
- Footer links row: add `Report a wrong finding` → the issue-templates chooser
  (`.../issues/new/choose`).

## Error handling

- `buildReportUrl` never throws; over-long inputs are truncated with `…`.
- CLI printing of the report link must not affect exit codes or stdout JSON
  purity (stderr only).
- VS Code button failure to open a browser is non-fatal (ignore).

## Testing

- Unit tests for `buildReportUrl`: encoding, truncation, template/title/body
  params present.
- CLI suppress test asserts the report URL is printed on success.
- VS Code: unit-test the URL passed to the (injected) opener in the suppress
  action result path.
- Issue templates: YAML validity checked by loading in a test is overkill —
  verified by opening on GitHub after merge (manual).

## Success criteria

- A user can go from "this squiggle is wrong" to a filed GitHub issue in two
  clicks (suppress → Create) without typing anything.
- The corpus directory exists with at least the convention documented, and CI
  runs it like any other test.
- The website states the continuous-improvement loop and links the report flow.
