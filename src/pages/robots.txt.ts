import type { APIRoute } from 'astro';
import { getPublishedContent, publicCacheHeaders } from '../lib/content';
import { absoluteSiteUrl } from '../lib/site';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const content = await getPublishedContent();
  const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8' });
  publicCacheHeaders(headers, content);
  return new Response([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    `Sitemap: ${absoluteSiteUrl(request, '/sitemap.xml', content.view.cms)}`,
    '',
  ].join('\n'), { headers });
};
