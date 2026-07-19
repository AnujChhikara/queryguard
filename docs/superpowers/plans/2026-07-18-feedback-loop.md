# Feedback Loop (One-Click Reports + Corpus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users report wrong findings in one click (pre-filled GitHub issue from the suppress flow); confirmed reports become permanent corpus tests; README + website say so.

**Architecture:** A dependency-free `buildReportUrl()` helper in cardinal-core builds a `github.com/.../issues/new` URL with issue-form query params (field ids match the YAML templates). The CLI prints the link after `cardinal suppress`; the VS Code toast gains a "Report as false positive" button. Nothing is ever sent automatically. `packages/core/test/corpus/` holds one vitest file per confirmed report.

**Tech Stack:** TypeScript (strict), vitest, GitHub issue forms (YAML), Astro (website).

## Global Constraints

- No backend, no telemetry, no automatic upload; the user always reviews the pre-filled issue on GitHub before pressing Create.
- No new runtime dependencies.
- `buildReportUrl` never throws; long inputs truncated with `…`.
- CLI report link goes to **stderr only** (stdout JSON purity).
- Repo URL: `https://github.com/AnujChhikara/cardinal`.
- Style: `.js` import specifiers, commit after every task.

## File Structure

- `packages/core/src/report.ts` — `buildReportUrl()` (new)
- `packages/core/src/index.ts` — export it
- `.github/ISSUE_TEMPLATE/false-positive.yml`, `missed-catch.yml`, `crash.yml` (new)
- `packages/cli/src/suppress.ts` + `packages/cli/src/bin.ts` — return/print link
- `packages/vscode/src/suppress-action.ts` + `packages/vscode/src/extension.ts` — link + toast button
- `packages/core/test/corpus/` — convention README + seed case
- `README.md`, `packages/website/src/components/{Roadmap,Footer}.astro`

---

### Task 1: `buildReportUrl` in core

**Files:**
- Create: `packages/core/src/report.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/report.test.ts`

**Interfaces:**
- Produces: `buildReportUrl(input: { rule: string; anchor: string; message?: string; version?: string }): string`. Returns an issues/new URL with `template=false-positive.yml`, `labels=false-positive,corpus-candidate`, `title=[false-positive] <rule>: <anchor first 60 chars>`, and form-field params `rule`, `snippet` (the anchor, truncated to 1500 chars), `message` (truncated to 500), `version`. Field ids must match Task 2's YAML `id:` values exactly.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/report.test.ts
import { describe, it, expect } from "vitest";
import { buildReportUrl } from "../src/report.js";

describe("buildReportUrl", () => {
  it("builds an issues/new URL with template, labels, title and fields", () => {
    const url = buildReportUrl({
      rule: "n-plus-one",
      anchor: "prisma.post.findMany({ where: { authorId: user.id } })",
      message: "Query on \"post\" runs inside a loop (N+1).",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://github.com/AnujChhikara/cardinal/issues/new");
    expect(u.searchParams.get("template")).toBe("false-positive.yml");
    expect(u.searchParams.get("labels")).toBe("false-positive,corpus-candidate");
    expect(u.searchParams.get("title")).toContain("[false-positive] n-plus-one:");
    expect(u.searchParams.get("rule")).toBe("n-plus-one");
    expect(u.searchParams.get("snippet")).toContain("prisma.post.findMany");
    expect(u.searchParams.get("message")).toContain("runs inside a loop");
  });

  it("truncates long anchors and never throws", () => {
    const url = buildReportUrl({ rule: "n-plus-one", anchor: "x".repeat(10_000) });
    expect(url.length).toBeLessThan(6_000);
    expect(new URL(url).searchParams.get("snippet")!.endsWith("…")).toBe(true);
  });

  it("omits absent optional fields", () => {
    const u = new URL(buildReportUrl({ rule: "over-fetch", anchor: "db.q()" }));
    expect(u.searchParams.has("message")).toBe(false);
    expect(u.searchParams.has("version")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/report.test.ts`
Expected: FAIL — cannot resolve `../src/report.js`.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/report.ts
const REPO = "https://github.com/AnujChhikara/cardinal";

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export interface ReportInput {
  rule: string;
  /** Normalized query call text — the suppression anchor. */
  anchor: string;
  message?: string;
  version?: string;
}

/**
 * A pre-filled GitHub issue URL for reporting a false positive. Query params
 * map to the issue form's field ids (.github/ISSUE_TEMPLATE/false-positive.yml).
 * Never throws; long inputs are truncated so the URL stays well under browser
 * and GitHub limits.
 */
export function buildReportUrl(input: ReportInput): string {
  const params = new URLSearchParams({
    template: "false-positive.yml",
    labels: "false-positive,corpus-candidate",
    title: `[false-positive] ${input.rule}: ${clip(input.anchor, 60)}`,
    rule: input.rule,
    snippet: clip(input.anchor, 1500),
  });
  if (input.message) params.set("message", clip(input.message, 500));
  if (input.version) params.set("version", input.version);
  return `${REPO}/issues/new?${params.toString()}`;
}
```

In `packages/core/src/index.ts`, after `export * from "./schema/discover.js";` add:

```ts
export * from "./report.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/report.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/report.ts packages/core/src/index.ts packages/core/test/report.test.ts
git commit -m "feat(core): buildReportUrl — pre-filled false-positive issue link"
```

---

### Task 2: GitHub issue templates

**Files:**
- Create: `.github/ISSUE_TEMPLATE/false-positive.yml`
- Create: `.github/ISSUE_TEMPLATE/missed-catch.yml`
- Create: `.github/ISSUE_TEMPLATE/crash.yml`

**Interfaces:**
- Consumes: field ids `rule`, `snippet`, `message`, `version` must match Task 1's query params.
- Produces: three issue forms with auto-labels.

- [ ] **Step 1: Write the three templates**

```yaml
# .github/ISSUE_TEMPLATE/false-positive.yml
name: False positive
description: Cardinal flagged this, but it's fine.
title: "[false-positive] "
labels: ["false-positive", "corpus-candidate"]
body:
  - type: dropdown
    id: rule
    attributes:
      label: Rule
      options:
        - n-plus-one
        - unindexed-query
        - unbounded-read
        - over-fetch
        - order-by-rand
        - leading-wildcard-like
        - excessive-joins
    validations:
      required: true
  - type: textarea
    id: snippet
    attributes:
      label: The flagged code
      description: The query call Cardinal flagged (minimal is fine).
      render: ts
    validations:
      required: true
  - type: input
    id: message
    attributes:
      label: Diagnostic message
      description: What Cardinal said.
  - type: textarea
    id: why
    attributes:
      label: Why is this fine?
      description: e.g. the list is capped at 20, the loop is admin-only…
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Cardinal version + adapter
      placeholder: cardinal-cli 0.1.3, Prisma
```

```yaml
# .github/ISSUE_TEMPLATE/missed-catch.yml
name: Missed catch
description: This query is slow — Cardinal stayed quiet.
title: "[missed-catch] "
labels: ["missed-catch", "corpus-candidate"]
body:
  - type: textarea
    id: snippet
    attributes:
      label: The slow query code
      render: ts
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: What should have been flagged, and why?
    validations:
      required: true
  - type: input
    id: orm
    attributes:
      label: ORM / adapter
      placeholder: Prisma, Drizzle, Mongoose, TypeORM, raw SQL
  - type: input
    id: version
    attributes:
      label: Cardinal version
      placeholder: cardinal-cli 0.1.3
```

```yaml
# .github/ISSUE_TEMPLATE/crash.yml
name: Crash / error
description: The CLI or extension errored.
title: "[crash] "
labels: ["crash"]
body:
  - type: input
    id: command
    attributes:
      label: What did you run?
      placeholder: npx cardinal "src/**/*.ts"
    validations:
      required: true
  - type: textarea
    id: output
    attributes:
      label: Error output
      render: shell
    validations:
      required: true
  - type: textarea
    id: snippet
    attributes:
      label: Minimal code that triggers it (if known)
      render: ts
  - type: input
    id: version
    attributes:
      label: Cardinal version
      placeholder: cardinal-cli 0.1.3
```

- [ ] **Step 2: Sanity-check the YAML parses**

Run: `node -e "const {parse}=require('yaml'); for (const f of ['false-positive','missed-catch','crash']) { parse(require('fs').readFileSync('.github/ISSUE_TEMPLATE/'+f+'.yml','utf8')); console.log(f, 'ok'); }"`
(from repo root — `yaml` is available via the workspace). Expected: three `ok` lines.

- [ ] **Step 3: Commit**

```bash
git add .github/ISSUE_TEMPLATE
git commit -m "feat: issue templates for false positives, missed catches, crashes"
```

---

### Task 3: CLI prints the report link after suppress

**Files:**
- Modify: `packages/cli/src/suppress.ts`
- Modify: `packages/cli/src/bin.ts:39-57` (suppress branch)
- Test: `packages/cli/test/suppress.test.ts` (append)

**Interfaces:**
- Consumes: `buildReportUrl` from `cardinal-core` (Task 1); `plan.suppression.rule` / `.anchor` already present in `suppressCommand`.
- Produces: `suppressCommand` return type gains `reportUrl?: string` (set on success).

- [ ] **Step 1: Write the failing test** — append to `packages/cli/test/suppress.test.ts`, matching its existing fixture style (it builds a tmp dir and calls `suppressCommand`; reuse the same helpers in scope):

```ts
it("returns a pre-filled report URL on success", async () => {
  // Arrange a file with a suppressible finding, mirroring the existing
  // success-path test in this file (tmp dir + n-plus-one snippet).
  const dir = mkdtempSync(join(tmpdir(), "qg-report-"));
  try {
    writeFileSync(
      join(dir, "a.ts"),
      `async function r(prisma, ids){ for (const id of ids) { await prisma.post.findMany({ where: { authorId: id } }); } }`,
    );
    const res = await suppressCommand("a.ts:1", dir, { reason: "capped list" }, async () => "");
    expect(res.code).toBe(0);
    expect(res.reportUrl).toContain("issues/new");
    expect(res.reportUrl).toContain("template=false-positive.yml");
    expect(res.reportUrl).toContain("n-plus-one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

(Adjust imports at the top of the file if `mkdtempSync`/`tmpdir` aren't already imported there.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run test/suppress.test.ts`
Expected: FAIL — `reportUrl` is `undefined`.

- [ ] **Step 3: Implement.** In `packages/cli/src/suppress.ts`:
- Add `buildReportUrl` to the `cardinal-core` import.
- Change the return type to `Promise<{ code: number; message: string; reportUrl?: string }>`.
- Replace the final return with:

```ts
  const reportUrl = buildReportUrl({ rule: suppression.rule, anchor: suppression.anchor });
  return {
    code: 0,
    message: `suppressed ${suppression.rule} at ${relFile}:${line}${factMsg}`,
    reportUrl,
  };
```

In `packages/cli/src/bin.ts`, in the suppress branch after `console.log(res.message);` and before `process.exit(res.code);` add:

```ts
    if (res.reportUrl) {
      console.error(`\nThink Cardinal got this wrong? Report it (pre-filled): ${res.reportUrl}`);
    }
```

- [ ] **Step 4: Run the CLI suite**

Run: `pnpm --filter cardinal-core build && cd packages/cli && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/suppress.ts packages/cli/src/bin.ts packages/cli/test/suppress.test.ts
git commit -m "feat(cli): print pre-filled report link after suppress"
```

---

### Task 4: VS Code "Report as false positive" button

**Files:**
- Modify: `packages/vscode/src/suppress-action.ts`
- Modify: `packages/vscode/src/extension.ts:155-160` (runSuppress success branch)
- Test: `packages/vscode/test/suppress-action.test.ts` (append)

**Interfaces:**
- Consumes: `buildReportUrl` from `cardinal-core`.
- Produces: `SuppressResult` ok-variant gains `reportUrl: string`.

- [ ] **Step 1: Write the failing test** — append to `packages/vscode/test/suppress-action.test.ts`, reusing the file's existing helpers for a successful `performSuppression` call:

```ts
it("returns a pre-filled report URL on success", async () => {
  // Mirror the existing success-path test setup in this file (tmp dir with a
  // suppressible n-plus-one finding), then:
  const res = await performSuppression(params, io);
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.reportUrl).toContain("issues/new");
    expect(res.reportUrl).toContain("template=false-positive.yml");
  }
});
```

(Use the same `params`/`io` construction as the neighbouring success test — copy its arrange block verbatim.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/vscode && npx vitest run test/suppress-action.test.ts`
Expected: FAIL — `reportUrl` missing / type error.

- [ ] **Step 3: Implement.** In `packages/vscode/src/suppress-action.ts`:
- Add `buildReportUrl` to the `cardinal-core` import.
- Change the ok-variant of `SuppressResult` to
  `{ ok: true; message: string; knowledgeFile: string; reportUrl: string }`.
- In the final return of `performSuppression` add:

```ts
    reportUrl: buildReportUrl({ rule: plan.suppression.rule, anchor: plan.suppression.anchor }),
```

In `packages/vscode/src/extension.ts`, replace the success branch of `runSuppress`:

```ts
    if (res.ok) {
      refreshKnowledge();
      const pick = await vscode.window.showInformationMessage(
        `Cardinal: ${res.message}`,
        "Report as false positive",
      );
      if (pick === "Report as false positive") {
        void vscode.env.openExternal(vscode.Uri.parse(res.reportUrl));
      }
    } else if (res.error !== "cancelled") {
```

- [ ] **Step 4: Run the vscode suite + typecheck**

Run: `cd packages/vscode && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add packages/vscode/src/suppress-action.ts packages/vscode/src/extension.ts packages/vscode/test/suppress-action.test.ts
git commit -m "feat(vscode): report-as-false-positive button on the suppress toast"
```

---

### Task 5: Corpus directory + seed case

**Files:**
- Create: `packages/core/test/corpus/README.md`
- Create: `packages/core/test/corpus/fp-relation-filter-unindexed.test.ts`

**Interfaces:**
- Consumes: `analyzeSource` and `parsePrismaSchema` from core src.
- Produces: the corpus convention; CI runs these files like any test (vitest picks up `test/**/*.test.ts` automatically).

- [ ] **Step 1: Write the convention README**

```markdown
# Corpus — real-world reports, frozen as tests

One file per confirmed report from a user, named
`<kind>-<issue#>-<slug>.test.ts` where kind is `fp` (false positive),
`mc` (missed catch), or `crash`. Each file embeds the reported snippet inline
and asserts the **correct** verdict via `analyzeSource`.

Rules:
- A corpus test is added in the same PR that fixes the report, and links the
  issue in a comment.
- Corpus tests are never deleted — they are the guarantee that a fixed report
  can't regress.
- Seed cases (predating the report flow) use no issue number.
```

- [ ] **Step 2: Write the seed case (verifies a known FP-prevention behavior)**

```ts
// packages/core/test/corpus/fp-relation-filter-unindexed.test.ts
// Seed corpus case: a Prisma relation filter (`where: { posts: {...} }`) must
// not trip unindexed-query — the filter field is a relation, not a column.
import { describe, it, expect } from "vitest";
import { analyzeSource } from "../../src/engine.js";
import { parsePrismaSchema } from "../../src/schema/prisma.js";

const schema = parsePrismaSchema(
  "model User {\n  id Int @id\n  name String\n  posts Post[]\n}\nmodel Post {\n  id Int @id\n}",
  "/p/schema.prisma",
);

describe("corpus: relation filter is not an unindexed column", () => {
  it("stays silent", () => {
    const diags = analyzeSource(
      `async function f(p){ return p.user.findMany({ where: { posts: { some: { id: 1 } } } }); }`,
      "f.ts",
      null,
      null,
      schema,
    );
    expect(diags.filter((d) => d.ruleId === "unindexed-query")).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run it**

Run: `cd packages/core && npx vitest run test/corpus/`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/corpus
git commit -m "test(core): corpus convention + seed case"
```

---

### Task 6: README + website messaging

**Files:**
- Modify: `README.md` (new section after "Suppressing a diagnostic")
- Modify: `packages/website/src/components/Roadmap.astro`
- Modify: `packages/website/src/components/Footer.astro`

- [ ] **Step 1: README section** — insert after the "Suppressing a diagnostic" subsection:

```markdown
### Reporting a wrong finding

Cardinal is tuned by real codebases. If a finding is wrong — a false positive,
a missed catch, or a crash — report it with one of the
[issue templates](https://github.com/AnujChhikara/cardinal/issues/new/choose).
After `cardinal suppress` (or the VS Code suppress quick-fix) Cardinal offers a
**pre-filled report link** — review it on GitHub and press Create; nothing is
ever sent automatically. Every confirmed report ships as a permanent regression
test in [`packages/core/test/corpus/`](packages/core/test/corpus/), so a fixed
false positive can never come back.
```

- [ ] **Step 2: Website** — in `packages/website/src/components/Roadmap.astro`, after the `<h2 class="title" …>` line add:

```astro
    <p class="tuned" data-reveal>
      Tuned by real codebases: every wrong finding you
      <a href="https://github.com/AnujChhikara/cardinal/issues/new/choose">report</a>
      becomes a permanent test. Fixed once, fixed forever.
    </p>
```

and in its `<style>` block add:

```css
  .tuned {
    margin-top: 1.4rem;
    max-width: 52ch;
    color: #2b2b28;
    font-size: 1.02rem;
  }
  .tuned a {
    border-bottom: 1.5px solid var(--marker);
    text-decoration: none;
  }
```

In `packages/website/src/components/Footer.astro`, in the `.links` span add:

```astro
        <a href={`${repo}/issues/new/choose`}>Report a wrong finding</a>
```

- [ ] **Step 3: Verify build + full suite**

Run: `cd packages/website && npx astro build && cd ../.. && pnpm test`
Expected: site builds; all package tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md packages/website/src/components/Roadmap.astro packages/website/src/components/Footer.astro
git commit -m "docs: report-a-wrong-finding flow on README and website"
```

---

## Self-Review Notes

- **Spec coverage:** templates (T2), buildReportUrl + suppress hooks (T1/T3/T4), corpus (T5), README/website (T6). Spec's "blank issues stay allowed" → satisfied by simply not adding a `config.yml`.
- **Type consistency:** `buildReportUrl({ rule, anchor })` used identically in T3/T4; `reportUrl` optional on CLI result, required on vscode ok-variant (vscode success always has a plan, so it's always buildable).
- **Placeholder check:** T3/T4 tests reference "the existing success-path test setup" for arrange blocks — acceptable because the executor edits those exact files and the assertion code is given in full.
