import type { APIRoute } from "astro";

// Generated from the `site` config, so it stays correct if the domain changes.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL("sitemap.xml", site).href;
  const body = `User-agent: *
Allow: /

Sitemap: ${sitemap}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
};
