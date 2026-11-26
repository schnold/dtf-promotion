import type { APIContext, APIRoute } from 'astro';
import QRCode from 'qrcode';
import { createFirstAdmin, setupAllowed, userCount } from '../../../lib/admin-setup';
import {
  audit, checkLinks, checkLive, contentState, discardDraft, HttpError, listAudit, listMedia, listVersions, MAX_UPLOAD,
  publish, restoreVersion, saveDraft, setLiveUrl, siteSummary, SITE, uploadImage,
} from '../../../lib/admin-store';
import { type AdminUser, authConfigured, AuthNotConfiguredError, getAdminUser, getAuth } from '../../../lib/auth';
import { ValidationError } from '../../../lib/content-schema';
import { DatabaseUnavailableError, getPool } from '../../../lib/db';

export const prerender = false;

/**
 * JSON API of the admin (client: public/admin/app.js and public/admin/login.js).
 * Every route except the login helpers needs a session with completed two-factor setup.
 * Writes must come from this origin and carry the `x-admin: 1` header (CSRF).
 */

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

const clientIp = (ctx: APIContext) => ctx.request.headers.get('x-nf-client-connection-ip') || ctx.clientAddress || null;

function checkWrite(ctx: APIContext): void {
  if (ctx.request.headers.get('x-admin') !== '1') throw new HttpError(403, 'Forbidden');
  const origin = ctx.request.headers.get('origin');
  if (!origin || origin !== ctx.url.origin) throw new HttpError(403, 'Forbidden');
}

async function readJson(request: Request, limit = 2.5 * 1024 * 1024): Promise<Record<string, any>> {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'JSON erwartet');
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, 'Anfrage zu groß');
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw new HttpError(400, 'Ungültiges JSON');
  }
}

/** Copies Set-Cookie headers from a Better Auth response onto ours. */
function withCookies(response: Response, from: Response): Response {
  for (const cookie of from.headers.getSetCookie()) response.headers.append('Set-Cookie', cookie);
  return response;
}

async function authError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
  const messages: Record<string, string> = {
    INVALID_PASSWORD: 'Das aktuelle Passwort stimmt nicht.',
    PASSWORD_TOO_SHORT: 'Das neue Passwort ist zu kurz (mind. 12 Zeichen).',
    PASSWORD_TOO_LONG: 'Das neue Passwort ist zu lang.',
  };
  throw new HttpError(res.status === 429 ? 429 : 400, messages[body.code ?? ''] ?? body.message ?? 'Aktion fehlgeschlagen.');
}

/** Routes that work before the second factor is set up (used by the login page). */
async function handlePublic(ctx: APIContext, route: string, user: AdminUser | null): Promise<Response | null> {
  if (route === 'GET auth-state') {
    const count = await userCount();
    return json({ authReady: authConfigured(), setupNeeded: count === 0, setupAllowed: count === 0 && setupAllowed() && authConfigured(), signedIn: Boolean(user), twoFactorEnabled: Boolean(user?.twoFactorEnabled), email: user?.email ?? null });
  }
  if (route === 'POST setup') {
    checkWrite(ctx);
    if (!authConfigured()) throw new AuthNotConfiguredError();
    const body = await readJson(ctx.request, 4096);
    const created = await createFirstAdmin(body);
    await audit('setup_admin', { ip: clientIp(ctx), detail: created.email });
    return json({ ok: true });
  }
  if (route === 'POST enroll') {
    // Signed in with password, 2FA not set up yet: create the TOTP secret and show it as QR code.
    checkWrite(ctx);
    if (!user) throw new HttpError(401, 'Bitte zuerst mit E-Mail und Passwort anmelden.');
    if (user.twoFactorEnabled) throw new HttpError(400, 'Die Zwei-Faktor-Anmeldung ist bereits eingerichtet.');
    const body = await readJson(ctx.request, 4096);
    const res = await getAuth().api.enableTwoFactor({ body: { password: String(body.password ?? '') }, headers: ctx.request.headers, asResponse: true });
    if (!res.ok) await authError(res);
    const data = (await res.json()) as { totpURI: string; backupCodes: string[] };
    const secret = new URL(data.totpURI).searchParams.get('secret') ?? '';
    return withCookies(json({ qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 240 }), secret, backupCodes: data.backupCodes }), res);
  }
  if (route === 'POST logout') {
    checkWrite(ctx);
    const res = await getAuth().api.signOut({ headers: ctx.request.headers, asResponse: true });
    if (user) await audit('logout', { user, ip: clientIp(ctx) });
    return withCookies(json({ ok: true }), res);
  }
  return null;
}

async function handle(ctx: APIContext): Promise<Response> {
  if (!getPool()) throw new DatabaseUnavailableError();
  const parts = (ctx.params.path ?? '').split('/').filter(Boolean);
  const method = ctx.request.method;
  const route = `${method} ${parts.join('/')}`;
  const user = await getAdminUser(ctx.request.headers);

  const early = await handlePublic(ctx, route, user);
  if (early) return early;

  if (!user || !user.twoFactorEnabled) throw new HttpError(401, 'Bitte anmelden.');
  if (method !== 'GET') checkWrite(ctx);
  const ip = clientIp(ctx);

  if (route === 'GET me') return json({ email: user.email, name: user.name, role: user.role });

  if (route === 'POST me/password') {
    const body = await readJson(ctx.request, 4096);
    const res = await getAuth().api.changePassword({
      body: { currentPassword: String(body.current ?? ''), newPassword: String(body.next ?? ''), revokeOtherSessions: true },
      headers: ctx.request.headers,
      asResponse: true,
    });
    if (!res.ok) await authError(res);
    await audit('password_changed', { user, ip });
    return withCookies(json({ ok: true }), res);
  }

  if (route === 'GET audit') {
    if (user.role !== 'admin') throw new HttpError(403, 'Nur für Administratoren.');
    return json(await listAudit());
  }

  if (route === 'GET sites') return json([await siteSummary()]);

  // /sites/<id>/… — this admin manages exactly one site.
  if (parts[0] !== 'sites' || parts[1] !== SITE.id) throw new HttpError(404, 'Unbekannte Route');
  const action = `${method} ${parts.slice(2).join('/')}`;

  if (action === 'GET ') return json(await siteSummary());
  if (action === 'GET content') return json(await contentState());

  if (action === 'PUT content') {
    const body = await readJson(ctx.request);
    const result = await saveDraft(user, body.data, body.rev);
    await audit('save_draft', { user, ip, detail: { rev: result.rev } });
    return json(result);
  }

  if (action === 'POST publish') {
    const body = await readJson(ctx.request, 4096);
    return json(await publish(user, body.note, ip));
  }

  if (action === 'POST discard') {
    await discardDraft(user);
    await audit('discard_draft', { user, ip });
    return json({ ok: true });
  }

  if (action === 'GET versions') return json(await listVersions());

  if (method === 'POST' && parts[2] === 'versions' && parts[4] === 'restore') {
    const version = Number(parts[3]);
    if (!Number.isInteger(version) || version < 1) throw new HttpError(400, 'Ungültige Version');
    await restoreVersion(user, version);
    await audit('restore_version', { user, ip, detail: { version } });
    return json({ ok: true });
  }

  if (action === 'PUT live-url') {
    const body = await readJson(ctx.request, 2048);
    const result = await setLiveUrl(user, body.liveUrl);
    await audit('live_url', { user, ip, detail: result.liveUrl });
    return json(result);
  }

  if (action === 'GET live-check') {
    const st = await contentState();
    return json(await checkLive(st.published?.site?.liveUrl || ''));
  }

  if (action === 'GET link-check') return json(await checkLinks());

  if (action === 'GET media') return json(await listMedia());

  if (action === 'POST upload') {
    const length = Number(ctx.request.headers.get('content-length') || 0);
    if (length > MAX_UPLOAD) throw new HttpError(413, 'Datei zu groß (max. 4 MB). Bitte das Bild vorher verkleinern.');
    const name = String(ctx.url.searchParams.get('name') || 'bild').slice(0, 120);
    const result = await uploadImage(user, name, Buffer.from(await ctx.request.arrayBuffer()));
    await audit('upload', { user, ip, detail: result.url });
    return json(result);
  }

  throw new HttpError(404, 'Unbekannte Aktion');
}

export const ALL: APIRoute = async (ctx) => {
  try {
    return await handle(ctx);
  } catch (error) {
    const known = error instanceof DatabaseUnavailableError || error instanceof AuthNotConfiguredError;
    const status = error instanceof HttpError || error instanceof ValidationError || known ? (error as { status: number }).status : 500;
    if (status >= 500 && !known) console.error(error);
    return json({ error: status >= 500 && !known ? 'Interner Fehler' : (error as Error).message }, status);
  }
};
