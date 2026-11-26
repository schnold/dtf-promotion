import type { APIContext, APIRoute } from 'astro';
import QRCode from 'qrcode';
import { createFirstAdmin, setupAllowed, userCount } from '../../../lib/admin-setup';
import { createAccount, deleteAccount, listAccounts, resetPassword, resetTwoFactor, setRole } from '../../../lib/admin-users';
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
 * Every route except the login helpers needs a session. Two-factor login is optional per account:
 * Better Auth only creates the session after the code when the account has it switched on.
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
    INVALID_PASSWORD: 'Das Passwort stimmt nicht.',
    INVALID_CODE: 'Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.',
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

  if (!user) throw new HttpError(401, 'Bitte anmelden.');
  if (method !== 'GET') checkWrite(ctx);
  const ip = clientIp(ctx);

  if (route === 'GET me') return json({ id: user.id, email: user.email, name: user.name, role: user.role, twoFactorEnabled: user.twoFactorEnabled });

  // Two-factor login (optional): start → QR code + backup codes, confirm with a code from the app, or switch off.
  if (route === 'POST me/2fa/start') {
    if (user.twoFactorEnabled) throw new HttpError(400, 'Die Zwei-Faktor-Anmeldung ist bereits eingeschaltet.');
    const body = await readJson(ctx.request, 4096);
    const res = await getAuth().api.enableTwoFactor({ body: { password: String(body.password ?? '') }, headers: ctx.request.headers, asResponse: true });
    if (!res.ok) await authError(res);
    const data = (await res.json()) as { totpURI: string; backupCodes: string[] };
    const secret = new URL(data.totpURI).searchParams.get('secret') ?? '';
    return withCookies(json({ qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 240 }), secret, backupCodes: data.backupCodes }), res);
  }

  if (route === 'POST me/2fa/confirm') {
    if (user.twoFactorEnabled) throw new HttpError(400, 'Die Zwei-Faktor-Anmeldung ist bereits eingeschaltet.');
    const body = await readJson(ctx.request, 4096);
    const res = await getAuth().api.verifyTOTP({ body: { code: String(body.code ?? '').replace(/s/g, '') }, headers: ctx.request.headers, asResponse: true });
    if (!res.ok) await authError(res);
    await audit('totp_enrolled', { user, ip });
    return withCookies(json({ ok: true }), res);
  }

  if (route === 'POST me/2fa/disable') {
    if (!user.twoFactorEnabled) throw new HttpError(400, 'Die Zwei-Faktor-Anmeldung ist schon ausgeschaltet.');
    const body = await readJson(ctx.request, 4096);
    const res = await getAuth().api.disableTwoFactor({ body: { password: String(body.password ?? '') }, headers: ctx.request.headers, asResponse: true });
    if (!res.ok) await authError(res);
    await audit('totp_disabled', { user, ip });
    return withCookies(json({ ok: true }), res);
  }

  // People with access (admins only).
  if (parts[0] === 'users') {
    if (user.role !== 'admin') throw new HttpError(403, 'Nur für Administratoren.');
    const id = parts[1] ?? '';
    if (route === 'GET users') return json(await listAccounts());
    if (route === 'POST users') {
      const created = await createAccount(await readJson(ctx.request, 4096));
      await audit('user_created', { user, ip, detail: created.email });
      return json(created);
    }
    if (method === 'POST' && parts[2] === 'password' && parts.length === 3) {
      const target = await resetPassword(id, (await readJson(ctx.request, 4096)).password);
      await audit('password_reset', { user, ip, detail: target.email });
      return json({ ok: true });
    }
    if (method === 'POST' && parts[2] === '2fa-reset' && parts.length === 3) {
      const target = await resetTwoFactor(id);
      await audit('totp_reset', { user, ip, detail: target.email });
      return json({ ok: true });
    }
    if (method === 'PUT' && parts[2] === 'role' && parts.length === 3) {
      const target = await setRole(user.id, id, (await readJson(ctx.request, 4096)).role);
      await audit('role_changed', { user, ip, detail: `${target.email}: ${target.role}` });
      return json({ ok: true });
    }
    if (method === 'DELETE' && parts.length === 2) {
      const target = await deleteAccount(user.id, id);
      await audit('user_deleted', { user, ip, detail: target.email });
      return json({ ok: true });
    }
    throw new HttpError(404, 'Unbekannte Aktion');
  }

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
