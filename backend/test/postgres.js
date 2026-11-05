import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createDb, migrate } from '../src/db.js';
import { seedDemoData } from '../src/seed.js';
import { startLocalPostgres } from '../src/local-postgres.js';

// One PostgreSQL server per test file; one fresh database per test.
// Set TEST_DATABASE_URL (for example the Docker database) to use an existing
// server instead of the embedded one. Test databases are created and dropped
// there, so never point it at real data.
let server;
let adminUrl;

async function ensureServer() {
  if (adminUrl) return;
  if (process.env.TEST_DATABASE_URL) {
    adminUrl = process.env.TEST_DATABASE_URL;
    return;
  }
  server = await startLocalPostgres();
  adminUrl = server.url('postgres');
}

async function admin(sql) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** Creates an empty database, migrates it and seeds demo data (both optional). */
export async function freshDb(
  t,
  { seed = true, migrate: runMigrations = true } = {},
) {
  await ensureServer();
  const name = `takistir_test_${randomBytes(6).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const db = createDb(url.toString(), { max: 5 });
  t.after(async () => {
    await db.close();
    await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  });
  if (runMigrations) await migrate(db);
  if (runMigrations && seed) await seedDemoData(db);
  return { db, url: url.toString() };
}

export async function stopServer() {
  await server?.stop();
}
