import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { DatabaseUnavailableError, getPool, query } from './db';

/**
 * Admin login (Better Auth). Email + password; two-factor login (TOTP) is optional per account and
 * switched on in "Konto". With it on, Better Auth creates the session only after the code.
 * There is no public sign-up: the first admin is created once on /admin/login with
 * ADMIN_SETUP_TOKEN (see README); further people are added by an admin under "Benutzer".
 *
 * Required environment on Netlify: BETTER_AUTH_SECRET (≥ 32 random characters) and NETLIFY_DB_URL
 * (set automatically by Netlify Database).
 */
const DEV = import.meta.env.DEV;

/** Origins allowed to send state-changing requests (Better Auth checks the Origin header). */
function trustedOrigins(): string[] {
  const list = [
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
    process.env.PUBLIC_SITE_URL,
    'https://dtf-transferprint.de',
    'https://www.dtf-transferprint.de',
    'https://dtf-promotion.netlify.app',
    ...(DEV ? ['http://localhost:4321', 'http://127.0.0.1:4321'] : []),
  ];
  return [...new Set(list.filter((origin): origin is string => Boolean(origin?.trim())).map((origin) => new URL(origin).origin))];
}

/** Production refuses to run the login with Better Auth's built-in fallback secret. */
export function authConfigured(): boolean {
  return DEV || (process.env.BETTER_AUTH_SECRET?.trim().length ?? 0) >= 32;
}

export class AuthNotConfiguredError extends Error {
  status = 503;
  constructor() {
    super('Die Anmeldung ist noch nicht eingerichtet: BETTER_AUTH_SECRET (mind. 32 Zeichen) fehlt in Netlify.');
  }
}

function createAuth() {
  if (!authConfigured()) throw new AuthNotConfiguredError();
  const database = getPool();
  if (!database) throw new DatabaseUnavailableError();
  return betterAuth({
    appName: 'DTF Transferprint Admin',
    secret: process.env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    database,
    trustedOrigins: trustedOrigins(),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 12, // absolute: 12 h
      updateAge: 60 * 60, // sliding refresh once per hour
      freshAge: 60 * 15,
    },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'editor', input: false },
      },
    },
    rateLimit: {
      enabled: !DEV,
      // Netlify runs many short-lived function instances, so counters must live in the database.
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 15 * 60, max: 10 },
        '/two-factor/verify-totp': { window: 15 * 60, max: 10 },
        '/two-factor/verify-backup-code': { window: 15 * 60, max: 10 },
        '/two-factor/enable': { window: 15 * 60, max: 10 },
        '/change-password': { window: 15 * 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'dtf-admin',
      useSecureCookies: !DEV,
      ipAddress: { ipAddressHeaders: ['x-nf-client-connection-ip', 'x-forwarded-for'] },
      defaultCookieAttributes: { sameSite: 'strict' },
    },
    databaseHooks: {
      session: {
        create: {
          // Every new session (password step, or password + code) lands in the admin's audit log.
          after: async (session) => {
            await query('INSERT INTO audit (user_id, user_email, action, site_id, ip, detail) SELECT $1, email, $2, $3, $4, $5 FROM "user" WHERE id = $1', [
              session.userId,
              'login',
              'dtf-transferprint',
              session.ipAddress ?? null,
              session.userAgent?.slice(0, 200) ?? null,
            ]).catch((error) => console.error('audit login failed', error));
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'DTF Transferprint Admin',
        backupCodeOptions: { amount: 8, length: 10 },
      }),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  twoFactorEnabled: boolean;
}

/** The signed-in user for this request (password and, if switched on, the 2FA code done), or null. */
export async function getAdminUser(headers: Headers): Promise<AdminUser | null> {
  if (!getPool() || !authConfigured()) return null;
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const user = session.user as typeof session.user & { role?: string | null; twoFactorEnabled?: boolean | null };
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'editor',
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
  };
}
