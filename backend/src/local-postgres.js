import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';

/**
 * Starts a private PostgreSQL 17 server from the `embedded-postgres` dev
 * dependency, so `npm run dev` and `npm test` work without Docker or a system
 * installation. Not used when DATABASE_URL (or TEST_DATABASE_URL) is set.
 *
 * persistentDir: keep data between runs (dev server); omit for a throwaway
 * cluster that is deleted on stop (tests).
 */
export async function startLocalPostgres({ persistentDir, port } = {}) {
  let EmbeddedPostgres;
  try {
    ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
  } catch {
    throw new Error(
      'DATABASE_URL is not set and the embedded-postgres dev dependency is missing. Run npm ci or set DATABASE_URL.',
    );
  }
  const password = 'takistir-local';
  const user = 'takistir';
  port ??= persistentDir ? 54329 : await freePort();
  // The directory must not exist yet: initdb creates it with the right owner.
  const databaseDir =
    persistentDir ??
    join(tmpdir(), `takistir-pg-${randomBytes(6).toString('hex')}`);
  const server = new EmbeddedPostgres({
    databaseDir,
    user,
    password,
    port,
    persistent: Boolean(persistentDir),
    onLog: () => {},
    onError: () => {},
  });
  const { existsSync } = await import('node:fs');
  if (!existsSync(join(databaseDir, 'PG_VERSION'))) await server.initialise();
  await server.start();
  const url = (database) =>
    `postgres://${user}:${password}@127.0.0.1:${port}/${database}`;
  if (persistentDir) {
    const { default: pg } = await import('pg');
    const admin = new pg.Client({ connectionString: url('postgres') });
    await admin.connect();
    const exists = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = 'takistir'",
    );
    if (!exists.rowCount) await admin.query('CREATE DATABASE takistir');
    await admin.end();
  }
  return { url, stop: () => server.stop() };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}
