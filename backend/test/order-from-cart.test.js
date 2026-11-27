import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { freshDb, stopServer } from './postgres.js';

after(stopServer);

// SCRUM-55: placing an order updates the customer's server cart in the same
// transaction as the order and the stock decrease.

const address = {
  name: 'Deniz Yılmaz',
  street: 'Demo Sok. No: 1',
  city: 'İstanbul',
  postcode: '34000',
};

async function setup(t) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  function client() {
    let cookie = '';
    const call = async (path, method = 'GET', body) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Takistir-Request': '1',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      for (const c of res.headers.getSetCookie()) {
        if (c.startsWith('takistir_session=')) cookie = c.split(';')[0];
      }
      return { status: res.status, body: await res.json() };
    };
    call.add = (id, qty) => call(`/cart/items/${id}`, 'PUT', { qty });
    call.lines = async () =>
      (await call('/cart')).body.items.map((i) => [i.id, i.qty]);
    call.order = (key, items) =>
      call('/orders', 'POST', { key, items, address });
    return call;
  }
  async function customer(n) {
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
  return { db, customer, stock };
}

test('ordering the whole cart empties it in the same request', async (t) => {
  const { customer, stock } = await setup(t);
  const buyer = await customer(1);
  await buyer.add('TK-001', 2);
  await buyer.add('TK-002', 1);
  const order = await buyer.order('whole-cart', [
    { id: 'TK-001', qty: 2 },
    { id: 'TK-002', qty: 1 },
  ]);
  assert.equal(order.status, 200);
  assert.deepEqual(await buyer.lines(), []);
  assert.equal(await stock('TK-001'), 10);
  assert.equal(await stock('TK-002'), 7);
});

test('only ordered products and quantities leave the cart', async (t) => {
  const { customer } = await setup(t);
  const buyer = await customer(1);
  await buyer.add('TK-001', 3);
  await buyer.add('TK-002', 1);
  await buyer.add('TK-003', 2);
  const order = await buyer.order('part', [
    { id: 'TK-001', qty: 1 },
    { id: 'TK-003', qty: 2 },
  ]);
  assert.equal(order.status, 200);
  assert.deepEqual(await buyer.lines(), [
    ['TK-001', 2],
    ['TK-002', 1],
  ]);
});

test('ordering without a server cart still works', async (t) => {
  const { customer } = await setup(t);
  const buyer = await customer(1);
  const order = await buyer.order('no-cart', [{ id: 'TK-001', qty: 1 }]);
  assert.equal(order.status, 200);
  assert.deepEqual(await buyer.lines(), []);
});

test('a failed order leaves the cart and stock unchanged', async (t) => {
  const { customer, stock } = await setup(t);
  const buyer = await customer(1);
  await buyer.add('TK-001', 1);
  await buyer.add('TK-002', 2);
  // TK-004 is sold out, so the whole order is rejected and rolled back.
  const order = await buyer.order('fails', [
    { id: 'TK-001', qty: 1 },
    { id: 'TK-004', qty: 1 },
  ]);
  assert.equal(order.status, 409);
  assert.deepEqual(await buyer.lines(), [
    ['TK-001', 1],
    ['TK-002', 2],
  ]);
  assert.equal(await stock('TK-001'), 12);
});

test('an invalid address rolls back the order, stock and cart together', async (t) => {
  const { customer, stock } = await setup(t);
  const buyer = await customer(1);
  await buyer.add('TK-002', 2);
  const r = await buyer('/orders', 'POST', {
    key: 'bad-address',
    items: [{ id: 'TK-002', qty: 2 }],
    address: { ...address, city: '' },
  });
  assert.equal(r.status, 400);
  assert.deepEqual(await buyer.lines(), [['TK-002', 2]]);
  assert.equal(await stock('TK-002'), 8);
});

test('a retried checkout does not remove items added again afterwards', async (t) => {
  const { customer, stock } = await setup(t);
  const buyer = await customer(1);
  await buyer.add('TK-001', 1);
  const first = await buyer.order('retry', [{ id: 'TK-001', qty: 1 }]);
  assert.equal(first.status, 200);
  assert.deepEqual(await buyer.lines(), []);
  // The customer adds the same product again, then the old request is retried.
  await buyer.add('TK-001', 2);
  const retry = await buyer.order('retry', [{ id: 'TK-001', qty: 1 }]);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data, first.body.data);
  assert.deepEqual(await buyer.lines(), [['TK-001', 2]]);
  assert.equal(await stock('TK-001'), 11);
});

test('the same checkout sent twice at once removes the items once', async (t) => {
  const { customer } = await setup(t);
  const buyer = await customer(1);
  await buyer.add('TK-001', 3);
  const items = [{ id: 'TK-001', qty: 1 }];
  const [a, b] = await Promise.all([
    buyer.order('double', items),
    buyer.order('double', items),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body.data, b.body.data);
  assert.deepEqual(await buyer.lines(), [['TK-001', 2]]);
});

test('two customers racing for the last unit: only the winner’s cart changes', async (t) => {
  const { db, customer, stock } = await setup(t);
  await db.query(
    "UPDATE products SET stock_quantity = 1 WHERE code = 'TK-003'",
  );
  const [a, b] = await Promise.all([customer(1), customer(2)]);
  await a.add('TK-003', 1);
  await b.add('TK-003', 1);
  const results = await Promise.all([
    a.order('race-a', [{ id: 'TK-003', qty: 1 }]),
    b.order('race-b', [{ id: 'TK-003', qty: 1 }]),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(await stock('TK-003'), 0);
  const winner = results[0].status === 200 ? a : b;
  const loser = winner === a ? b : a;
  assert.deepEqual(await winner.lines(), []);
  // The loser keeps the item, now shown as unavailable.
  const loserCart = (await loser('/cart')).body;
  assert.deepEqual(
    loserCart.items.map((i) => [i.id, i.qty, i.available]),
    [['TK-003', 1, false]],
  );
});

test('an order never touches another customer’s cart', async (t) => {
  const { customer } = await setup(t);
  const [a, b] = await Promise.all([customer(1), customer(2)]);
  await a.add('TK-001', 1);
  await b.add('TK-001', 1);
  assert.equal((await a.order('own', [{ id: 'TK-001', qty: 1 }])).status, 200);
  assert.deepEqual(await a.lines(), []);
  assert.deepEqual(await b.lines(), [['TK-001', 1]]);
});

test('guests still cannot place orders', async (t) => {
  const { db } = await setup(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const res = await fetch(
    `http://127.0.0.1:${server.address().port}/api/orders`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Takistir-Request': '1',
      },
      body: JSON.stringify({
        key: 'guest',
        items: [{ id: 'TK-001', qty: 1 }],
        address,
      }),
    },
  );
  assert.equal(res.status, 401);
});
