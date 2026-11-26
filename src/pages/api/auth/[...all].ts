import type { APIRoute } from 'astro';
import { authConfigured, AuthNotConfiguredError, getAuth } from '../../../lib/auth';
import { getPool } from '../../../lib/db';

export const prerender = false;

/** Better Auth endpoints (sign-in, two-factor, sign-out, change password …) under /api/auth/*. */
export const ALL: APIRoute = async ({ request }) => {
  if (!getPool()) {
    return Response.json({ message: 'Die Datenbank ist nicht verbunden.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!authConfigured()) {
    return Response.json({ message: new AuthNotConfiguredError().message }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const response = await getAuth().handler(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};
