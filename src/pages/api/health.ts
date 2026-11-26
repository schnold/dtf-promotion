import type { APIRoute } from 'astro';
import { DEFAULT_SETTINGS } from '../../lib/settings';

export const prerender = false;

/** Prices are validated from cms.json at build time; reaching this handler means the function and its settings loaded. */
export const GET: APIRoute = () => {
  const healthy = DEFAULT_SETTINGS.tiers.length > 0;
  return new Response(JSON.stringify({ status: healthy ? 'ok' : 'unavailable' }), {
    status: healthy ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
};

export const ALL: APIRoute = () => new Response('Method Not Allowed', {
  status: 405,
  headers: { Allow: 'GET' },
});
