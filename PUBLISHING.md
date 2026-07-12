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

## 4. Tag the release (optional)

```bash
git tag v0.1.0 && git push origin v0.1.0
gh release create v0.1.0 --generate-notes
```

## Automating later

CI (build + test on every push/PR) is set up in `.github/workflows/ci.yml`. To
automate publishing on a tag, add a release workflow that runs the commands above
using repo **secrets** `NPM_TOKEN` and `VSCE_PAT` (Settings → Secrets and
variables → Actions). Left manual for now so the first releases are deliberate.
