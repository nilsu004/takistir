import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { demoAccounts, seedDemoData } from '../src/seed.js';
import { passwordMatches } from '../src/passwords.js';
import { freshDb, stopServer } from './postgres.js';

after(stopServer);

test('the demo database contains every supported role with hashed passwords', async (t) => {
  const { db } = await freshDb(t);
  const { rows } = await db.query('SELECT * FROM users ORDER BY id');
  assert.deepEqual(rows.map((u) => u.role).sort(), [
    'customer',
    'product-manager',
    'sales-manager',
    'support-agent',
  ]);
  for (const account of demoAccounts) {
    const row = rows.find((u) => u.id === account.id);
    assert.equal(row.email, account.email);
    assert.notEqual(row.password_hash, account.password);
    assert(passwordMatches(account.password, row.password_hash));
    assert(!Object.hasOwn(row, 'password'));
  }
});

test('the database rejects unsupported roles and case-variant duplicate emails', async (t) => {
  const { db } = await freshDb(t);
  await assert.rejects(
    db.query("UPDATE users SET role = 'admin' WHERE id = 'CU-001'"),
    { code: '23514' },
  );
  await assert.rejects(
    db.query(
      "UPDATE users SET email = 'DENIZ@example.com' WHERE id = 'PM-001'",
    ),
    { code: '23514' },
  );
  await assert.rejects(
    db.query(
      "UPDATE users SET email = 'deniz@example.com' WHERE id = 'PM-001'",
    ),
    { code: '23505' },
  );
  assert.equal(
    (await db.query("SELECT role FROM users WHERE id = 'CU-001'")).rows[0].role,
    'customer',
  );
});

test('an existing local database gains missing demo roles without resetting accounts or catalogue', async (t) => {
  const { db } = await freshDb(t);
  await db.query("DELETE FROM users WHERE id IN ('SM-001', 'SA-001')");
  await db.query(
    "UPDATE users SET name = 'My edited account' WHERE id = 'CU-001'",
  );
  await db.query(
    "UPDATE products SET stock_quantity = 7 WHERE code = 'TK-001'",
  );
  const before = (
    await db.query('SELECT id, password_hash FROM users ORDER BY id')
  ).rows;
  assert.equal(await seedDemoData(db), false);
  assert.equal(await seedDemoData(db), false);
  const { rows } = await db.query(
    'SELECT id, password_hash FROM users ORDER BY id',
  );
  assert.equal(rows.length, 4);
  for (const row of before)
    assert.equal(
      rows.find((u) => u.id === row.id).password_hash,
      row.password_hash,
    );
  assert.equal(
    (await db.query("SELECT name FROM users WHERE id = 'CU-001'")).rows[0].name,
    'My edited account',
  );
  assert.equal(
    (
      await db.query(
        "SELECT stock_quantity FROM products WHERE code = 'TK-001'",
      )
    ).rows[0].stock_quantity,
    7,
  );
});

test('demo backfill never promotes or resets a customer using a demo email', async (t) => {
  const { db } = await freshDb(t);
  await db.query("DELETE FROM users WHERE id = 'SM-001'");
  await db.query(
    `INSERT INTO users (id, name, email, role, password_hash)
     SELECT 'EXISTING', 'Existing customer', 'sales@takistir.local', 'customer', password_hash
     FROM users WHERE id = 'CU-001'`,
  );
  const before = (await db.query("SELECT * FROM users WHERE id = 'EXISTING'"))
    .rows[0];
  await seedDemoData(db);
  assert.deepEqual(
    (await db.query("SELECT * FROM users WHERE id = 'EXISTING'")).rows[0],
    before,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM users WHERE id = 'SM-001'"))
      .rows[0].n,
    0,
  );
});

async function api(t) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  async function call(path, body) {
    const res = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Takistir-Request': '1',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.headers.get('set-cookie'))
      cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, body: await res.json() };
  }
  return { call };
}

for (const account of demoAccounts)
  test(`${account.role} can sign in without exposing credentials`, async (t) => {
    const { call } = await api(t);
    const result = await call('/auth/login', {
      email: account.email,
      password: account.password,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.state.user.role, account.role);
    assert(!Object.hasOwn(result.body.state.user, 'password_hash'));
    assert(!Object.hasOwn(result.body.state.user, 'password'));
    assert(!JSON.stringify(result.body).includes(account.password));
    const cart = await call('/cart');
    assert.equal(cart.status, account.role === 'customer' ? 200 : 403);
  });

test('public signup cannot select any of the three staff roles', async (t) => {
  const { call } = await api(t);
  for (const role of ['product-manager', 'sales-manager', 'support-agent']) {
    const result = await call('/auth/register', {
      name: 'Self registration',
      email: `${role}@example.com`,
      password: 'CustomerPass!24',
      role,
    });
    assert.equal(result.status, 403);
  }
});
