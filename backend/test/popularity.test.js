// Popularity = seeded starting value + units sold here (SCRUM-45 decision);
// seeded rating counts are separate from popularity.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { products as seedProducts } from '../../shared/seed.js';
import { catalogProducts } from '../../shared/catalog-rules.js';
import { freshDb, stopServer } from './postgres.js';

after(stopServer);

const address = {
  name: 'Deniz',
  street: 'Demo street 1',
  city: 'İstanbul',
  postcode: '34000',
};
const seeded = (code) => seedProducts.find((p) => p.id === code);

async function store(t) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function login(email, password) {
    let cookie = '';
    const call = async (path, method = 'GET', body) => {
      const res = await fetch(base + path, {
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
    if (email)
      assert.equal(
        (await call('/auth/login', 'POST', { email, password })).status,
        200,
      );
    return call;
  }
  const customer = await login('deniz@example.com', 'CustomerDemo!24');
  const manager = await login('manager@takistir.local', 'ManagerDemo!24');
  const sales = await login('sales@takistir.local', 'SalesDemo!24');
  const guest = await login();
  const products = async (who = guest) =>
    (await who('/state')).body.state.products;
  const product = async (code, who) =>
    (await products(who)).find((p) => p.id === code);
  async function buy(code, qty) {
    const r = await customer('/orders', 'POST', {
      key: randomUUID(),
      items: [{ id: code, qty }],
      address,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.data;
  }
  async function deliver(id) {
    for (const status of ['In transit', 'Delivered'])
      assert.equal(
        (await manager(`/manager/orders/${id}/status`, 'PATCH', { status }))
          .status,
        200,
      );
  }
  return { db, customer, sales, products, product, buy, deliver };
}

test('a new store shows the seeded popularity', async (t) => {
  const { products } = await store(t);
  for (const p of await products())
    assert.equal(p.popularity, seeded(p.id).popularity, p.id);
});

test('a purchase adds the units sold to popularity', async (t) => {
  const { product, buy } = await store(t);
  await buy('TK-002', 3);
  assert.equal(
    (await product('TK-002')).popularity,
    seeded('TK-002').popularity + 3,
  );
  // Other products are unchanged.
  assert.equal(
    (await product('TK-001')).popularity,
    seeded('TK-001').popularity,
  );
});

test('a cancelled order no longer counts towards popularity', async (t) => {
  const { customer, product, buy } = await store(t);
  const id = await buy('TK-002', 2);
  assert.equal((await customer(`/orders/${id}/cancel`, 'POST')).status, 200);
  assert.equal(
    (await product('TK-002')).popularity,
    seeded('TK-002').popularity,
  );
});

test('returned items still count as sold', async (t) => {
  const { customer, sales, product, buy, deliver } = await store(t);
  const id = await buy('TK-002', 2);
  await deliver(id);
  const r = await customer(`/orders/${id}/returns`, 'POST', {
    selected: { 'TK-002': 1 },
  });
  assert.equal(r.status, 200);
  const returnId = r.body.state.orders.find((o) => o.id === id).returnRequest
    .id;
  await sales(`/sales/returns/${returnId}/receive`, 'POST', {
    confirmed: true,
  });
  assert.equal(
    (await sales(`/sales/returns/${returnId}/approve`, 'POST', {})).status,
    200,
  );
  assert.equal(
    (await product('TK-002')).popularity,
    seeded('TK-002').popularity + 2,
  );
});

test('imported demo orders are not counted twice', async (t) => {
  const { db, product } = await store(t);
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM orders WHERE NOT inventory_reserved',
  );
  assert.ok(rows[0].n > 0, 'seed should contain imported demo orders');
  for (const code of ['TK-001', 'TK-002', 'TK-003'])
    assert.equal(
      (await product(code)).popularity,
      seeded(code).popularity,
      code,
    );
});

test('popularity sort changes after enough sales', async (t) => {
  const { products, buy } = await store(t);
  const before = catalogProducts(await products());
  const top = before[0];
  // A product with stock that is not first yet.
  const challenger = before.find(
    (p) => p.id !== top.id && p.stock > 0 && p.price !== null,
  );
  const needed = top.popularity - challenger.popularity + 1;
  assert.ok(needed <= challenger.stock, 'not enough stock for this test');
  await buy(challenger.id, needed);
  const after = catalogProducts(await products());
  assert.equal(after[0].id, challenger.id);
});

test('seeded rating counts are separate from popularity', async (t) => {
  const { db } = await store(t);
  for (const p of seedProducts) {
    assert.ok(
      Number.isInteger(p.ratingCount) && p.ratingCount > 0,
      `${p.id} needs a ratingCount`,
    );
    assert.ok(
      p.ratingCount < p.popularity,
      `${p.id}: fewer people rate than buy`,
    );
  }
  const { rows } = await db.query(
    'SELECT code, seed_rating_count FROM products',
  );
  for (const r of rows)
    assert.equal(r.seed_rating_count, seeded(r.code).ratingCount, r.code);
});

test('a sale does not change the rating count', async (t) => {
  const { product, buy } = await store(t);
  const before = (await product('TK-002')).publishedRating.count;
  await buy('TK-002', 2);
  assert.equal((await product('TK-002')).publishedRating.count, before);
});
