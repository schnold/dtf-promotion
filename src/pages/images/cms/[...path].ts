import type { APIRoute } from 'astro';
import { getMedia } from '../../../lib/admin-store';
import { getPool } from '../../../lib/db';

export const prerender = false;

/** Images uploaded in the admin. Paths never change content (new upload = new name), so they cache forever. */
export const GET: APIRoute = async ({ params }) => {
  const path = `/images/cms/${params.path ?? ''}`;
  const file = getPool() && /^\/images\/cms\/[\w.-]+$/.test(path) ? await getMedia(path) : null;
  if (!file) return new Response('Nicht gefunden', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.mime,
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=31536000, immutable',
      ETag: `"${file.sha256}"`,
    },
  });
};
