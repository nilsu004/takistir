import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDb, migrate } from './db.js';
import { seedDemoData } from './seed.js';
import { startLocalPostgres } from './local-postgres.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const production = process.env.NODE_ENV === 'production';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

let connectionString = process.env.DATABASE_URL;
let localPostgres = null;
if (!connectionString) {
  if (production)
    throw new Error('DATABASE_URL is required when NODE_ENV=production.');
  // Development without Docker: a private PostgreSQL kept in backend/data/
  // (or LOCAL_PG_DIR). Delete that folder to start again from demo data.
  const persistentDir = process.env.LOCAL_PG_DIR
    ? resolve(process.env.LOCAL_PG_DIR)
    : fileURLToPath(new URL('../data/postgres', import.meta.url));
  localPostgres = await startLocalPostgres({ persistentDir });
  connectionString = localPostgres.url('takistir');
  console.log(
    `DATABASE_URL not set: using local PostgreSQL in ${persistentDir}`,
  );
}

const db = createDb(connectionString);
const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
// Demo accounts have publicly known passwords, so they are never created in
// production.
if (!production && (await seedDemoData(db)))
  console.log('Seeded demo catalogue, orders and test accounts.');

const server = createApp({ db }).listen(port, host);

server.on('listening', () => {
  console.log(`Takistir API listening at http://${host}:${port}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Unable to start API: port ${port} on ${host} is already in use. Stop the existing server before running npm run dev again.`,
    );
  } else {
    console.error(`Unable to start API: ${error.message}`);
  }
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await db.close();
      await localPostgres?.stop();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
