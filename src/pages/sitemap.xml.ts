import type { APIRoute } from 'astro';
import { absoluteSiteUrl } from '../lib/site';

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  const pageUrl = absoluteSiteUrl(request, '/');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${pageUrl}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};

