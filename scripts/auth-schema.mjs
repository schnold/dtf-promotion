#!/usr/bin/env node
/**
 * Prints the SQL that Better Auth needs for the options used in src/lib/auth.ts, compared with
 * the database in NETLIFY_DB_URL (an empty database prints the full schema).
 * Use it to write a new file in netlify/database/migrations/ after changing auth plugins or fields:
 *
 *   NETLIFY_DB_URL=postgres://… node scripts/auth-schema.mjs
 *
 * Keep the options below in step with the schema-relevant parts of src/lib/auth.ts.
 */
import pg from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { twoFactor } from 'better-auth/plugins';

const url = process.env.NETLIFY_DB_URL;
if (!url) {
  console.error('NETLIFY_DB_URL fehlt.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
const { compileMigrations } = await getMigrations({
  database: pool,
  secret: 'schema-only-not-used-for-anything-at-all',
  emailAndPassword: { enabled: true },
  user: { additionalFields: { role: { type: 'string', required: false, defaultValue: 'editor', input: false } } },
  rateLimit: { enabled: true, storage: 'database' },
  plugins: [twoFactor()],
});
console.log(await compileMigrations());
await pool.end();
