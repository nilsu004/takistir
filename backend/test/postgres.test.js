import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db.js';
import { seedDemoData } from '../src/seed.js';
import { freshDb, stopServer } from './postgres.js';

after(stopServer);

const address = {
  name: 'Test',
  street: 'Demo street 1',
  city: 'İstanbul',
  postcode: '34000',
};

async function api(t) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  function client() {
    let cookie = '';
    return async (path, method = 'GET', body) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Takistir-Request': '1',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  }
  async function newCustomer(n) {
    const c = client();
    const r = await c('/auth/register', 'POST', {
      email: `buyer${n}@example.com`,
      name: `Buyer ${n}`,
      password: 'BuyerPass!24',
    });
    assert.equal(r.status, 200);
    return c;
  }
  const stock = async (code) =>
    (
      await db.query('SELECT stock_quantity FROM products WHERE code = $1', [
        code,
      ])
    ).rows[0].stock_quantity;
  return { db, client, newCustomer, stock };
}

test('migrations are recorded and running them again changes nothing', async (t) => {
  const { db } = await freshDb(t, { seed: false });
  const { rows } = await db.query(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  assert.deepEqual(
    rows.map((r) => r.version.slice(0, 3)),
    ['001', '003', '004'],
  );
  assert.deepEqual(await migrate(db), []);
});

test('a database where 001 was applied by hand with psql is adopted, not re-created', async (t) => {
  const { db } = await freshDb(t, { seed: false, migrate: false });
  // The workflow documented in backend/db/README.md before this runner existed.
  await db.query(
    readFileSync(
      new URL(
        '../db/migrations/001_create_categories_and_products.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.deepEqual(await migrate(db), [
    '003_extend_catalogue_for_store.sql',
    '004_create_accounts_orders_reviews.sql',
  ]);
  const { rows } = await db.query(
    "SELECT 1 FROM schema_migrations WHERE version LIKE '001_%'",
  );
  assert.equal(rows.length, 1);
});

test('seeding twice does not duplicate demo data', async (t) => {
  const { db } = await freshDb(t);
  assert.equal(await seedDemoData(db), false);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  assert.equal(rows[0].n, 2);
});

test('rows inserted without the new store columns get safe defaults (DB team seeds stay valid)', async (t) => {
  const { db } = await freshDb(t, { seed: false });
  const { rows } = await db.query(
    `WITH c AS (INSERT INTO categories (name) VALUES ('Watches') RETURNING id)
     INSERT INTO products (category_id, name, model, serial_number, description,
       stock_quantity, price, warranty_status, distributor)
     SELECT id, 'Classic Leather Watch', 'WTC-LTH-01', 'TKS-WTC-0001', 'Quartz',
       14, 4250.00, '2 years', 'Anadolu Saat'
     FROM c RETURNING code, archived, image, price`,
  );
  assert.match(rows[0].code, /^PRD-\d{4}$/);
  assert.equal(rows[0].archived, false);
  assert.equal(rows[0].price, 4250);
});

test('the database itself rejects negative stock and duplicate category names', async (t) => {
  const { db } = await freshDb(t);
  await assert.rejects(
    db.query("UPDATE products SET stock_quantity = -1 WHERE code = 'TK-001'"),
    { code: '23514' },
  );
  await assert.rejects(
    db.query("INSERT INTO categories (name) VALUES (' rings ')"),
    { code: '23505' },
  );
});

test('a failed checkout rolls back: no order and no stock change', async (t) => {
  const { db, client, stock } = await api(t);
  const customer = client();
  await customer('/auth/login', 'POST', {
    email: 'deniz@example.com',
    password: 'CustomerDemo!24',
  });
  const before = (await db.query('SELECT count(*)::int AS n FROM orders'))
    .rows[0].n;
  // TK-001 is available, but TK-004 is out of stock, so the whole order fails.
  const r = await customer('/orders', 'POST', {
    key: 'rollback-1',
    items: [
      { id: 'TK-001', qty: 1 },
      { id: 'TK-004', qty: 1 },
    ],
    address,
  });
  assert.equal(r.status, 409);
  assert.equal(await stock('TK-001'), 12);
  const afterCount = (await db.query('SELECT count(*)::int AS n FROM orders'))
    .rows[0].n;
  assert.equal(afterCount, before);
});

test('an invalid delivery address rolls back the stock decrease', async (t) => {
  const { client, stock } = await api(t);
  const customer = client();
  await customer('/auth/login', 'POST', {
    email: 'deniz@example.com',
    password: 'CustomerDemo!24',
  });
  const r = await customer('/orders', 'POST', {
    key: 'bad-address',
    items: [{ id: 'TK-002', qty: 2 }],
    address: { ...address, city: '' },
  });
  assert.equal(r.status, 400);
  assert.equal(await stock('TK-002'), 8);
});

test('many concurrent buyers: exactly the available stock is sold', async (t) => {
  const { db, newCustomer, stock } = await api(t);
  await db.query(
    "UPDATE products SET stock_quantity = 3 WHERE code = 'TK-003'",
  );
  const buyers = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(newCustomer));
  const results = await Promise.all(
    buyers.map((buy, i) =>
      buy('/orders', 'POST', {
        key: `crowd-${i}`,
        items: [{ id: 'TK-003', qty: 1 }],
        address,
      }),
    ),
  );
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 200).length, 3);
  assert.equal(statuses.filter((s) => s === 409).length, 5);
  assert.equal(await stock('TK-003'), 0);
});

test('checkouts locking the same products in opposite order do not deadlock', async (t) => {
  const { newCustomer, stock } = await api(t);
  const [a, b] = await Promise.all([newCustomer(1), newCustomer(2)]);
  const results = await Promise.all([
    a('/orders', 'POST', {
      key: 'ab',
      items: [
        { id: 'TK-001', qty: 1 },
        { id: 'TK-002', qty: 1 },
      ],
      address,
    }),
    b('/orders', 'POST', {
      key: 'ba',
      items: [
        { id: 'TK-002', qty: 1 },
        { id: 'TK-001', qty: 1 },
      ],
      address,
    }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.equal(await stock('TK-001'), 10);
  assert.equal(await stock('TK-002'), 6);
});

test('the same checkout sent twice at once creates one order and one stock decrease', async (t) => {
  const { db, newCustomer, stock } = await api(t);
  const buyer = await newCustomer(1);
  const body = {
    key: 'double-click',
    items: [{ id: 'TK-001', qty: 2 }],
    address,
  };
  const [first, second] = await Promise.all([
    buyer('/orders', 'POST', body),
    buyer('/orders', 'POST', body),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.data, second.body.data);
  assert.equal(await stock('TK-001'), 10);
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM orders WHERE checkout_key = 'double-click'",
  );
  assert.equal(rows[0].n, 1);
});

test('new order numbers skip numbers already used', async (t) => {
  const { db, newCustomer } = await api(t);
  await db.query("SELECT setval('order_number_seq', 1023)"); // next is 1024 (seeded)
  const buyer = await newCustomer(1);
  const r = await buyer('/orders', 'POST', {
    key: 'numbering',
    items: [{ id: 'TK-001', qty: 1 }],
    address,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.data, 'TK-1025');
});

test('expired sessions are treated as signed out', async (t) => {
  const { db, client } = await api(t);
  const customer = client();
  await customer('/auth/login', 'POST', {
    email: 'deniz@example.com',
    password: 'CustomerDemo!24',
  });
  assert.equal((await customer('/state')).body.state.user.id, 'CU-001');
  await db.query(
    "UPDATE sessions SET expires_at = now() - interval '1 second'",
  );
  assert.equal((await customer('/state')).body.state.user, null);
  assert.equal((await customer('/orders/TK-1011/invoice')).status, 401);
});

test('state revision increases after each change', async (t) => {
  const { client } = await api(t);
  const manager = client();
  const login = await manager('/auth/login', 'POST', {
    email: 'manager@takistir.local',
    password: 'ManagerDemo!24',
  });
  const before = login.body.state.revision;
  const changed = await manager('/manager/products/TK-001/stock', 'PATCH', {
    stock: 5,
  });
  assert(changed.body.state.revision > before);
  assert.equal(
    changed.body.state.products.find((p) => p.id === 'TK-001').stock,
    5,
  );
});

test('a deleted category with archived products keeps their history and can be restored', async (t) => {
  const { client } = await api(t);
  const manager = client();
  await manager('/auth/login', 'POST', {
    email: 'manager@takistir.local',
    password: 'ManagerDemo!24',
  });
  assert.equal(
    (await manager('/manager/products/TK-003', 'DELETE')).status,
    200,
  );
  assert.equal(
    (await manager('/manager/categories/Rings', 'DELETE')).status,
    200,
  );
  let state = (await manager('/state')).body.state;
  assert(!state.categories.includes('Rings'));
  // Order TK-1024 still shows the archived ring and its category.
  assert.equal(state.products.find((p) => p.id === 'TK-003').category, 'Rings');
  assert.equal(
    (await manager('/manager/categories', 'POST', { name: 'rings' })).status,
    200,
  );
  state = (await manager('/state')).body.state;
  assert(state.categories.includes('rings'));
});
