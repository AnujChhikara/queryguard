# Marketing Website — Design Spec

_Date: 2026-07-12._

## 1. Goal

A single-page, minimalist marketing site for QueryGuard: what it is, the primary
link to the extension/repo, and where it's headed. Editorial, high-contrast,
fast. Refinement expected later — this is the first shippable cut.

## 2. Stack & hosting

- **Astro** (static output), in `packages/website` (pnpm workspace member).
- **Vercel** (zero-config static deploy; no base-path juggling).
- Minimal shipped JS (Astro islands only if truly needed — likely none).

## 3. Visual language (from the reference image)

- **Background:** off-white `#F8F8F6` with a subtle graph-paper grid (~40px
  cells, hairline `#E4E4E0`).
- **Ink:** near-black `#0A0A0A`. **Accent:** marker yellow `#FFE500`.
- **Type:** an editorial grotesk for display (Space Grotesk) + Inter for body.
  Headlines are large (`clamp()`), heavy (700–800), tight tracking + line-height.
- **Signature move:** one keyword in the hero gets a **hand-drawn yellow marker
  highlight** (a rough SVG ellipse / highlighter swipe behind the word).
- **Hero visual:** a monochrome code block showing a real QueryGuard N+1
  diagnostic, wrapped in a soft **yellow glow** — the dev-tool stand-in for the
  reference image's haloed portrait.
- **Buttons:** pill-shaped, black outline, small icon, invert on hover.
- **Labels:** uppercase, small, letter-spaced (the editorial header treatment).

## 4. Page structure (single scroll)

1. **Header bar** — `QUERYGUARD` (left) · `v0.0.0 · GitHub` (right), thin rule.
2. **Hero** — headline with the yellow-highlighted keyword, one-line subhead,
   primary button → **GitHub repo**, plus a muted "Coming to the VS Code
   Marketplace" note. Right/!below: the glowing diagnostic code block.
3. **What it does** — three rule cards (`n-plus-one`, `unbounded-read`,
   `over-fetch`) + two promises: **database-aware** and **100% static — your code
   never leaves your machine**.
4. **How it works** — adapters (Prisma, Drizzle, Mongoose, raw SQL) + the
   optional knowledge file (scale-aware); a small **before → after** code sample
   with the fix highlighted in yellow.
5. **What's next** — roadmap chips: config file, more engines, deeper analysis,
   Marketplace release.
6. **Footer** — GitHub link, MIT, credit.

## 5. Components

`Header`, `Hero`, `Features`, `HowItWorks`, `Roadmap`, `Footer` (Astro
components), one `global.css` (tokens + grid background + type scale),
`index.astro` composing them. Content is hard-coded (no CMS).

## 6. Out of scope (later)

Blog/docs pages, analytics, dark mode, animations beyond subtle hover, a real OG
image pipeline (one static OG image is enough), Marketplace deep-link (swap in
when published).

## 7. Success criteria

`pnpm --filter queryguard-website build` produces a static `dist/`; the page
renders the six sections with the visual language above; the primary CTA links to
the GitHub repo; Lighthouse-fast (near-zero JS).
