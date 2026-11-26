import type { APIRoute } from 'astro';
import { getPublishedContent, publicCacheHeaders } from '../lib/content';
import { absoluteSiteUrl } from '../lib/site';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const content = await getPublishedContent();
  const { cms } = content.view;
  const pageUrl = absoluteSiteUrl(request, '/', cms);
  // Last publish in the admin; before that the date maintained in cms.json.
  const lastmod = content.publishedAt ? content.publishedAt.toISOString().slice(0, 10) : cms.site.lastmod;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${pageUrl}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;

  const headers = new Headers({ 'Content-Type': 'application/xml; charset=utf-8' });
  publicCacheHeaders(headers, content);
  return new Response(xml, { headers });
};
