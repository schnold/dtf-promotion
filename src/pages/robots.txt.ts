import type { APIRoute } from 'astro';
import { absoluteSiteUrl } from '../lib/site';

export const prerender = false;

export const GET: APIRoute = ({ request }) => new Response([
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin',
  'Disallow: /api/',
  `Sitemap: ${absoluteSiteUrl(request, '/sitemap.xml')}`,
  '',
].join('\n'), {
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
});

