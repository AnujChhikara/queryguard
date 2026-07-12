# Cardinal v0 Launch Checklist

Work top to bottom. **Order matters:** fix-before-publish → verify → publish npm +
extension → deploy site (its CTA should point at the published artifacts). The
credentialed commands live in [`PUBLISHING.md`](PUBLISHING.md); this file is the
full sequence with the testing steps.

---

## 0. Fix before publishing (small polish, no accounts needed)

- [ ] **Extension icon** — add a 128×128 PNG at `packages/vscode/icon.png` and
      `"icon": "icon.png"` in its `package.json`. The Marketplace listing looks
      broken without one.
- [ ] **CHANGELOG.md** — add one at the repo root and in `packages/vscode/`
      (the Marketplace shows it). Start with a `## 0.1.0` entry.
- [ ] **Dead docs links** — rule diagnostics link to `https://cardinal.dev/rules/…`
      which doesn't exist. Point `docsUrl` at the GitHub docs (or drop it) until
      the site has rule pages.
- [ ] **Stale README** — the "Build & test" section still says "18 tests"; it's
      146 now. Fix the number (or drop the count).
- [ ] **`examples/anti-patterns.ts`** — commit it as a repo example, or delete it
      (currently untracked).
- [ ] Decide the **domain** (e.g. `getcardinal.dev`) and buy it now so DNS can
      propagate while you finish the rest.

---

## 1. Pre-flight verification (automated)

- [ ] `pnpm install` clean.
- [ ] `pnpm build` — all four packages build (incl. core DTS).
- [ ] `pnpm test` — full suite green (core/cli/vscode).
- [ ] `pnpm -r typecheck` — no type errors.
- [ ] CI green on `main` (GitHub Actions).
- [ ] `git status` clean; everything committed and pushed.

---

## 2. Manual test — CLI

- [ ] `node packages/cli/dist/bin.js "examples/anti-patterns.ts"` → 8 findings
      (4 `n-plus-one` errors, 4 `unbounded-read` warnings), exit `1`.
- [ ] A file with `ORDER BY RAND()`, `LIKE '%x'`, and a 5-JOIN query → the three
      SQL rules fire.
- [ ] Add a `cardinal.knowledge.yaml` → `over-fetch` fires / small loops silenced;
      stderr notes the knowledge file.
- [ ] Add a `cardinal.config.json` with a rule `"off"` → that rule disappears;
      `--no-config` ignores it.
- [ ] `cardinal suppress "<file>:<line>" --reason "x"` → writes an entry; re-run
      shows the finding gone.
- [ ] Clean file → `0 problem(s)`, exit `0`.

---

## 3. Manual test — VS Code extension (do this in the Extension Dev Host)

> Open `packages/vscode` in VS Code and press **F5** (or Run → Start Debugging) to
> launch the Extension Development Host. This is the one surface with no automated
> UI test, so exercise it by hand.

- [ ] Open a `.ts` file with an N+1 → red squiggle + entry in the **Problems**
      panel; hover shows the message, `source: cardinal`, and the rule id.
- [ ] Repeat in `.js`, `.tsx`, `.jsx` — all four activate.
- [ ] Typing feels responsive (diagnostics update ~300ms after you stop).
- [ ] Add `cardinal.knowledge.yaml` in the workspace → diagnostics update **live**
      (over-fetch appears / small loop goes quiet) without reloading.
- [ ] Add `cardinal.config.json` with `{"rules":{"unbounded-read":"off"}}` → those
      squiggles vanish live; delete it → they come back.
- [ ] **Quick-fix:** click the lightbulb (`⌘.` / `Ctrl+.`) on a squiggle →
      **Suppress "<rule>" (Cardinal)** → reason prompt → on submit the entry is
      written to `cardinal.knowledge.yaml` and the squiggle clears. Cancel (Esc)
      → nothing written.
- [ ] When a fact is implied, the **Record / Skip** prompt appears and Record
      writes `tables.X.rows`.
- [ ] Toggle **Settings → Cardinal → Use Knowledge** off → knowledge-driven
      behavior stops; on → resumes.
- [ ] No errors in the Extension Host's Debug Console.

### Package + local install test

- [ ] `cd packages/vscode && pnpm run package` → `cardinal.vsix`.
- [ ] `code --install-extension packages/vscode/cardinal.vsix` in a normal window
      (ideally a clean profile) → repeat a couple of the checks above on a real
      project.

---

## 4. Publish — npm (`cardinal-core`, `cardinal-cli`)

Unscoped names — no org needed; they publish under your account.

- [ ] `npm login` (2FA enabled).
- [ ] `pnpm build` (fresh `dist/`).
- [ ] `pnpm --filter cardinal-core publish` (**core first** — cli depends on it;
      `pnpm publish` rewrites `workspace:*` → `0.1.0`).
- [ ] `pnpm --filter cardinal-cli publish`.
- [ ] Verify: `npm view cardinal-cli`, then in a scratch dir
      `npm i -D cardinal-cli && npx cardinal "**/*.ts"`.

---

## 5. Publish — VS Code Marketplace

- [ ] Create the publisher `anujchhikara` at
      https://marketplace.visualstudio.com/manage (one-time).
- [ ] Create an Azure DevOps **PAT** with **Marketplace → Manage** scope.
- [ ] `cd packages/vscode && npx vsce login anujchhikara` (paste PAT).
- [ ] `pnpm run package && npx vsce publish` (or `--packagePath cardinal.vsix`).
- [ ] Verify the listing renders (README, icon, categories) and install it from
      the Marketplace in a fresh VS Code.
- [ ] *(Optional)* Open VSX for Cursor/VSCodium:
      `npx ovsx publish cardinal.vsix -p <token>`.

---

## 6. Deploy — website (Vercel)

- [ ] After npm + extension are live, **update the site CTA**: primary button →
      the Marketplace listing, and add the `npm i -D cardinal-cli` line and the
      Marketplace link. (Currently the CTA points at GitHub.)
- [ ] Import the repo at https://vercel.com/new → set **Root Directory** =
      `packages/website` (Astro auto-detected). Deploy.
- [ ] Add the custom domain in Vercel → **Domains**; set DNS at your registrar.
- [ ] Verify the live URL: sections render, links work, Lighthouse is fast.
- [ ] *(Optional)* Add a static OG image for link previews.

---

## 7. GitHub + release polish

- [ ] Set the repo **description** and **topics** (linter, prisma, n+1, sql,
      vscode-extension, static-analysis).
- [ ] Add README **badges**: npm version, CI status, Marketplace, license.
- [ ] Tag the release: `git tag v0.1.0 && git push origin v0.1.0` then
      `gh release create v0.1.0 --generate-notes`.
- [ ] *(Optional)* `CONTRIBUTING.md`, issue templates.

---

## 8. Post-launch

- [ ] Try it on one real project; note false positives to feed the precision work.
- [ ] Wire the deferred **release automation** (publish on tag) using repo secrets
      `NPM_TOKEN` + `VSCE_PAT` (see `PUBLISHING.md`).
- [ ] Collect the first issues; pick the next rule/adapter from the roadmap.
