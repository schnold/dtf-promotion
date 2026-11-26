import { createHash, timingSafeEqual } from 'node:crypto';
import { getAuth } from './auth';
import { HttpError } from './admin-store';
import { query } from './db';

/**
 * First-run setup: while no account exists, /admin/login offers to create the admin account.
 * It needs ADMIN_SETUP_TOKEN (set in Netlify, ≥ 16 characters), so nobody else can claim the
 * empty admin first. Once an account exists, setup is closed for good; remove the variable then.
 */
const setupToken = () => process.env.ADMIN_SETUP_TOKEN?.trim() ?? '';

export const setupAllowed = () => setupToken().length >= 16;

export async function userCount(): Promise<number> {
  const [row] = await query<{ n: string }>('SELECT count(*) AS n FROM "user"');
  return Number(row.n);
}

const sha = (value: string) => createHash('sha256').update(value).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

export async function createFirstAdmin(input: { token?: unknown; name?: unknown; email?: unknown; password?: unknown }) {
  if (!setupAllowed()) throw new HttpError(403, 'Die Einrichtung ist nicht freigeschaltet (ADMIN_SETUP_TOKEN fehlt in Netlify).');
  if (!sameSecret(String(input.token ?? ''), setupToken())) throw new HttpError(403, 'Der Einrichtungs-Code stimmt nicht.');
  if ((await userCount()) > 0) throw new HttpError(409, 'Es gibt bereits ein Admin-Konto. Bitte anmelden.');

  const email = String(input.email ?? '').trim().toLowerCase();
  const name = String(input.name ?? '').trim().slice(0, 100) || 'Admin';
  const password = String(input.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
  if (password.length < 12 || password.length > 128) throw new HttpError(400, 'Das Passwort braucht 12 bis 128 Zeichen.');
  if (password.toLowerCase().includes(email.split('@')[0])) throw new HttpError(400, 'Das Passwort darf die E-Mail-Adresse nicht enthalten.');

  const ctx = await getAuth().$context;
  const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: true, role: 'admin' }, { method: 'admin' });
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: await ctx.password.hash(password) });
  return { id: user.id, email };
}
