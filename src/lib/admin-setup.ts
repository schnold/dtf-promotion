import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from './admin-store';
import { createAccount } from './admin-users';
import { query } from './db';

/**
 * First-run setup: while no account exists, /admin/login offers to create the admin account.
 * It needs ADMIN_SETUP_TOKEN (set in Netlify, ≥ 16 characters), so nobody else can claim the
 * empty admin first. Once an account exists, setup is closed for good; remove the variable then.
 * Further people are added by an admin under "Benutzer".
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
  return createAccount({ name: String(input.name ?? '').trim() || 'Admin', email: input.email, password: input.password, role: 'admin' });
}
