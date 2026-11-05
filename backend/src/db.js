import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = fileURLToPath(
  new URL('../db/migrations/', import.meta.url),
);

// node-postgres returns NUMERIC as strings (to avoid float rounding) and turns
// DATE into a local-time Date. The API works with numbers and 'YYYY-MM-DD'.
const NUMERIC = 1700;
const DATE = 1082;
const types = {
  getTypeParser(oid, format) {
    if (oid === NUMERIC) return (value) => Number(value);
    if (oid === DATE) return (value) => value;
    return pg.types.getTypeParser(oid, format);
  },
};

/**
 * Creates a connection pool plus a transaction helper.
 * `tx(fn)` runs fn(client) between BEGIN and COMMIT and rolls back if fn throws,
 * so a failed checkout never leaves stock half-updated.
 */
export function createDb(connectionString, { max = 10 } = {}) {
  const pool = new pg.Pool({ connectionString, max, types });
  pool.on('error', (error) =>
    console.error('PostgreSQL pool error:', error.message),
  );
  return {
    pool,
    query: (text, params) => pool.query(text, params),
    async tx(fn, { readOnly = false } = {}) {
      const client = await pool.connect();
      try {
        await client.query(
          readOnly
            ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
            : 'BEGIN',
        );
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * Applies backend/db/migrations/*.sql in file-name order, once each.
 * Applied versions are recorded in schema_migrations. A database where 001 was
 * applied by hand with psql (before this runner existed) is detected and 001
 * is recorded instead of failing.
 */
export async function migrate(db) {
  const client = await db.pool.connect();
  try {
    // Serialises concurrent starts (for example two API processes).
    await client.query('SELECT pg_advisory_lock(30842)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Set(
      (await client.query('SELECT version FROM schema_migrations')).rows.map(
        (r) => r.version,
      ),
    );
    const files = readdirSync(migrationsDir)
      .filter((f) => /^\d{3}_.+\.sql$/.test(f))
      .sort();
    const ran = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      if (file.startsWith('001_') && (await tableExists(client, 'products'))) {
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [file],
        );
        continue;
      }
      // Each migration file contains its own BEGIN/COMMIT.
      try {
        await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [file],
      );
      ran.push(file);
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock(30842)').catch(() => {});
    client.release();
  }
}

async function tableExists(client, name) {
  const { rows } = await client.query('SELECT to_regclass($1) AS t', [
    `public.${name}`,
  ]);
  return rows[0].t !== null;
}
