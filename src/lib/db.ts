import { getDatabase, MissingDatabaseConnectionError } from '@netlify/database';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

/**
 * Netlify Database (Postgres). The connection string comes from `NETLIFY_DB_URL`, which Netlify
 * sets in production, in deploy previews (own database branch) and in `netlify dev`.
 * Without it the public page still renders from the bundled src/data/cms.json; only the admin
 * needs the database.
 */
let pool: Pool | null | undefined;

export function getPool(): Pool | null {
  if (pool !== undefined) return pool;
  try {
    pool = getDatabase().pool as unknown as Pool;
  } catch (error) {
    if (!(error instanceof MissingDatabaseConnectionError)) throw error;
    pool = null;
  }
  return pool;
}

export class DatabaseUnavailableError extends Error {
  status = 503;
  constructor() {
    super('Die Datenbank ist nicht verbunden (NETLIFY_DB_URL fehlt).');
  }
}

function requirePool(): Pool {
  const current = getPool();
  if (!current) throw new DatabaseUnavailableError();
  return current;
}

export async function query<T extends QueryResultRow = Record<string, any>>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await requirePool().query<T>(text, params);
  return result.rows;
}

export interface Tx {
  query<T extends QueryResultRow = Record<string, any>>(text: string, params?: unknown[]): Promise<T[]>;
}

/** Runs `fn` in one transaction; rolls back on any error. */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client: PoolClient = await requirePool().connect();
  try {
    await client.query('BEGIN');
    const tx: Tx = {
      query: async <R extends QueryResultRow>(text: string, params: unknown[] = []) => (await client.query<R>(text, params)).rows,
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
