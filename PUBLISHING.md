# Publishing Cardinal

Everything here needs **your** accounts/tokens, so it's a manual checklist rather
than automation. All packages are at `0.1.0`. Build first: `pnpm build`.

## 1. npm — `cardinal-core` and `cardinal-cli`

Unscoped package names — no npm organization required; they publish under your
account. Both manifests set `"publishConfig": { "access": "public" }`.

```bash
npm login                       # your npm account (2FA)
pnpm build                      # produces dist/ for both packages

# Publish core FIRST (cli depends on it):
pnpm --filter cardinal-core publish
pnpm --filter cardinal-cli  publish
```

Use **`pnpm publish`** (not `npm publish`) — it rewrites `cardinal-core:
workspace:*` in the CLI to the real `0.1.0` on publish. Verify with
`npm view cardinal-cli`, then `npx cardinal-cli "src/**/*.ts"`.

## 2. VS Code Marketplace — the extension

1. Create the publisher `anujchhikara` at
   https://marketplace.visualstudio.com/manage (one-time).
2. Create an Azure DevOps **Personal Access Token** with the **Marketplace →
   Manage** scope (https://dev.azure.com → User settings → Personal access
   tokens).
3. Publish:

```bash
cd packages/vscode
npx vsce login anujchhikara     # paste the PAT
pnpm run package                # builds + creates cardinal.vsix
npx vsce publish                # or: npx vsce publish --packagePath cardinal.vsix
```

Optional: also publish to **Open VSX** (for Cursor/VSCodium) with
`npx ovsx publish cardinal.vsix -p <openvsx-token>`.

> Note: the `.vsix` bundles `cardinal-core` (via tsup), so the extension does
> **not** depend on the npm publish above — you can ship it independently.

## 3. Website — Vercel

The site is a static Astro app in `packages/website`.

1. Import the repo at https://vercel.com/new.
2. Set **Root Directory** = `packages/website` (Vercel auto-detects Astro; build
   `astro build`, output `dist`).
3. Deploy. Add your custom domain (e.g. `getcardinal.dev`) in the project's
   Domains tab.

Or from the CLI: `cd packages/website && npx vercel --prod`.

## Releasing new versions (automated)

After the first manual publish above, **new versions ship via GitHub Actions on a
version tag** — no hand-run publish commands. The workflow is
`.github/workflows/release.yml`; it builds, tests, and publishes to **npm + VS
Code Marketplace + Open VSX**, then cuts a GitHub Release with the `.vsix`.

### Your release flow

```bash
pnpm release:version 0.2.0            # bumps core + cli + vscode in lockstep
git commit -am "release: v0.2.0"
git tag -a v0.2.0 -m "v0.2.0"        # annotated — required for --follow-tags
git push --follow-tags               # ← the tag triggers the Release workflow
```

> Use an **annotated** tag (`-a`). `git push --follow-tags` only pushes annotated
> tags; a lightweight `git tag v0.2.0` won't be pushed and the workflow won't run
> (in that case, `git push origin v0.2.0` explicitly).

Versions must be **new** (npm and the Marketplace reject duplicates), so always
bump before tagging. Watch the run under the repo's **Actions** tab.

### One-time setup — three repo secrets

Add these under **Settings → Secrets and variables → Actions → New repository
secret**:

| Secret | Where to get it |
|--------|-----------------|
| `NPM_TOKEN` | npmjs.com → avatar → **Access Tokens → Generate New Token → Granular / Automation**. Use an **Automation** token — it bypasses 2FA in CI. Give it publish access to `cardinal-core` and `cardinal-cli`. |
| `VSCE_PAT` | Azure DevOps PAT with **Marketplace → Manage** scope (same as the manual publish). Make a fresh one for CI. |
| `OVSX_TOKEN` | open-vsx.org → Settings → **Access Tokens**. |

Once the three secrets exist, every `v*` tag publishes everywhere automatically.
You can also trigger it manually from the **Actions** tab (workflow_dispatch).
