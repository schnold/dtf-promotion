import type { APIRoute } from 'astro';
import { isSettingsStoreHealthy } from '../../lib/settings';

export const prerender = false;

export const GET: APIRoute = async () => {
  const healthy = await isSettingsStoreHealthy();
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
