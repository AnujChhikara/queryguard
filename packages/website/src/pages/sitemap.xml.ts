import type { APIRoute } from "astro";

// Config-driven sitemap (single-page site). Stays correct if the domain changes.
export const GET: APIRoute = ({ site }) => {
  const loc = new URL("/", site).href;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${loc}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
