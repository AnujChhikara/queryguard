import { defineConfig } from "astro/config";

// Static site. Vercel auto-detects Astro and serves dist/ with zero config.
export default defineConfig({
  // Canonical URL — used for og/canonical/sitemap. Swap to your custom domain
  // (e.g. https://getcardinal.dev) once it's live on Vercel.
  site: "https://cardinal-website-three.vercel.app",
});
