import { getAuth } from './auth';
import { HttpError } from './admin-store';
import { query } from './db';

/**
 * Account management for the admin. Admins (role 'admin') add and remove people; a new person
 * signs in with email + password right away. Two-factor login is optional per person and is
 * switched on in "Konto" (and can be reset here by an admin if a phone gets lost).
 */
export type Role = 'admin' | 'editor';
export const ROLES: Role[] = ['admin', 'editor'];

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  twoFactorEnabled: boolean;
  createdAt: string;
  lastLogin: string | null;
}

export function cleanEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse eingeben.');
  return email;
}

export function checkPassword(password: string, email: string): void {
  if (password.length < 12 || password.length > 128) throw new HttpError(400, 'Das Passwort braucht 12 bis 128 Zeichen.');
  const local = email.split('@')[0];
  if (local.length >= 3 && password.toLowerCase().includes(local)) throw new HttpError(400, 'Das Passwort darf die E-Mail-Adresse nicht enthalten.');
}

const cleanRole = (value: unknown): Role => (ROLES.includes(value as Role) ? (value as Role) : 'editor');

export async function listAccounts(): Promise<AccountRow[]> {
  const rows = await query<AccountRow & { createdAt: Date; lastLogin: Date | null }>(
    `SELECT u.id, u.name, u.email, coalesce(u.role, 'editor') AS role, coalesce(u."twoFactorEnabled", false) AS "twoFactorEnabled",
            u."createdAt", (SELECT max(s."createdAt") FROM session s WHERE s."userId" = u.id) AS "lastLogin"
       FROM "user" u ORDER BY u."createdAt"`,
  );
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString(), lastLogin: r.lastLogin ? new Date(r.lastLogin).toISOString() : null }));
}

export async function createAccount(input: { name?: unknown; email?: unknown; password?: unknown; role?: unknown }) {
  const email = cleanEmail(input.email);
  const name = String(input.name ?? '').trim().slice(0, 100);
  if (!name) throw new HttpError(400, 'Bitte einen Namen eingeben.');
  const password = String(input.password ?? '');
  checkPassword(password, email);
  const [exists] = await query('SELECT 1 FROM "user" WHERE email = $1', [email]);
  if (exists) throw new HttpError(409, 'Für diese E-Mail-Adresse gibt es schon ein Konto.');

  const ctx = await getAuth().$context;
  const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: true, role: cleanRole(input.role) }, { method: 'admin' });
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: await ctx.password.hash(password) });
  return { id: user.id, email };
}

async function account(id: string): Promise<AccountRow> {
  const [row] = await query<AccountRow>(`SELECT id, name, email, coalesce(role, 'editor') AS role FROM "user" WHERE id = $1`, [id]);
  if (!row) throw new HttpError(404, 'Konto nicht gefunden.');
  return row;
}

async function adminCount(): Promise<number> {
  const [row] = await query<{ n: string }>(`SELECT count(*) AS n FROM "user" WHERE role = 'admin'`);
  return Number(row.n);
}

/** Sets a new password and signs the person out everywhere. */
export async function resetPassword(id: string, password: unknown) {
  const target = await account(id);
  const value = String(password ?? '');
  checkPassword(value, target.email);
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(value));
  await query('DELETE FROM session WHERE "userId" = $1', [id]);
  return target;
}

/** Turns two-factor login off for someone who lost their phone; they can set it up again in "Konto". */
export async function resetTwoFactor(id: string) {
  const target = await account(id);
  await query('UPDATE "user" SET "twoFactorEnabled" = false, "updatedAt" = now() WHERE id = $1', [id]);
  await query('DELETE FROM "twoFactor" WHERE "userId" = $1', [id]);
  await query('DELETE FROM session WHERE "userId" = $1', [id]);
  return target;
}

export async function setRole(selfId: string, id: string, role: unknown) {
  const target = await account(id);
  const next = cleanRole(role);
  if (target.role === 'admin' && next !== 'admin' && (id === selfId || (await adminCount()) <= 1)) {
    throw new HttpError(400, id === selfId ? 'Sie können sich nicht selbst die Admin-Rechte entziehen.' : 'Es muss mindestens ein Admin bleiben.');
  }
  await query('UPDATE "user" SET role = $2, "updatedAt" = now() WHERE id = $1', [id, next]);
  return { ...target, role: next };
}

export async function deleteAccount(selfId: string, id: string) {
  if (id === selfId) throw new HttpError(400, 'Sie können Ihr eigenes Konto nicht löschen.');
  const target = await account(id);
  if (target.role === 'admin' && (await adminCount()) <= 1) throw new HttpError(400, 'Es muss mindestens ein Admin bleiben.');
  await query('DELETE FROM "user" WHERE id = $1', [id]); // sessions, password and 2FA go with it (on delete cascade)
  return target;
}
