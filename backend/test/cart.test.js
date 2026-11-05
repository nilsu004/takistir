import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { freshDb, stopServer } from './postgres.js';

after(stopServer);

// SCRUM-49: cart API for guests and signed-in customers.

async function setup(t) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  // A browser-like client that keeps every cookie it receives.
  function client() {
    const jar = new Map();
    const call = async (path, method = 'GET', body) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Takistir-Request': '1',
          ...(jar.size
            ? {
                Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
              }
            : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const setCookies = res.headers.getSetCookie();
      for (const c of setCookies) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      return { status: res.status, body: await res.json(), setCookies };
    };
    call.jar = jar;
    return call;
  }
  async function signedIn(email, password) {
    const c = client();
    const r = await c('/auth/login', 'POST', { email, password });
    assert.equal(r.status, 200);
    return c;
  }
  const customer = () => signedIn('deniz@example.com', 'CustomerDemo!24');
  const manager = () => signedIn('manager@takistir.local', 'ManagerDemo!24');
  const put = (c, id, qty) => c(`/cart/items/${id}`, 'PUT', { qty });
  return { db, client, customer, manager, put };
}

test('a new guest has an empty cart and looking at it sets no cookie', async (t) => {
  const { client } = await setup(t);
  const guest = client();
  const r = await guest('/cart');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { items: [], total: 0 });
  assert(!r.setCookies.some((c) => c.startsWith('takistir_cart=')));
});

test('a guest can add an item; the cart cookie is HttpOnly and the price comes from the server', async (t) => {
  const { client, put } = await setup(t);
  const guest = client();
  const r = await put(guest, 'TK-001', 2);
  assert.equal(r.status, 200);
  const cookie = r.setCookies.find((c) => c.startsWith('takistir_cart='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.deepEqual(r.body.items, [
    {
      id: 'TK-001',
      name: 'Luna Pearl Necklace',
      image: 'necklace-card.svg',
      price: 1250,
      qty: 2,
      stock: 12,
      available: true,
    },
  ]);
  assert.equal(r.body.total, 2500);
  assert.deepEqual((await guest('/cart')).body, r.body);
});

test('the guest cart token is stored only as a hash', async (t) => {
  const { db, client, put } = await setup(t);
  const guest = client();
  await put(guest, 'TK-001', 1);
  const token = guest.jar.get('takistir_cart');
  const { rows } = await db.query('SELECT guest_token_hash FROM carts');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].guest_token_hash, token);
  assert.match(rows[0].guest_token_hash, /^[a-f0-9]{64}$/);
});

test('updating a quantity replaces it and recalculates the total', async (t) => {
  const { client, put } = await setup(t);
  const guest = client();
  await put(guest, 'TK-001', 1);
  await put(guest, 'TK-002', 1);
  const r = await put(guest, 'TK-001', 3);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
  assert.equal(r.body.items.find((i) => i.id === 'TK-001').qty, 3);
  assert.equal(r.body.total, 3 * 1250 + 890);
});

test('quantities above the stock are rejected and the cart is unchanged', async (t) => {
  const { client, put } = await setup(t);
  const guest = client();
  await put(guest, 'TK-003', 2);
  const r = await put(guest, 'TK-003', 7); // only 6 in stock
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Only 6 left/);
  assert.equal((await guest('/cart')).body.items[0].qty, 2);
});

test('invalid quantities are rejected', async (t) => {
  const { client, put } = await setup(t);
  const guest = client();
  for (const qty of [0, -1, 1.5, '2', null, undefined])
    assert.equal((await put(guest, 'TK-001', qty)).status, 400, String(qty));
  assert.deepEqual((await guest('/cart')).body.items, []);
});

test('out-of-stock products stay visible in the catalogue but cannot be added', async (t) => {
  const { client, put } = await setup(t);
  const guest = client();
  const r = await put(guest, 'TK-004', 1);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /out of stock/);
  const catalogue = (await guest('/state')).body.state.products;
  assert(catalogue.some((p) => p.id === 'TK-004' && p.stock === 0));
});

test('unknown, removed and unpriced products cannot be added', async (t) => {
  const { db, client, put } = await setup(t);
  const guest = client();
  assert.equal((await put(guest, 'NOPE-1', 1)).status, 404);
  await db.query("UPDATE products SET archived = TRUE WHERE code = 'TK-003'");
  assert.equal((await put(guest, 'TK-003', 1)).status, 404);
  await db.query("UPDATE products SET price = NULL WHERE code = 'TK-002'");
  const unpriced = await put(guest, 'TK-002', 1);
  assert.equal(unpriced.status, 409);
  assert.match(unpriced.body.error, /not on sale/);
});

test('a price sent by the client is ignored', async (t) => {
  const { client } = await setup(t);
  const guest = client();
  const r = await guest('/cart/items/TK-001', 'PUT', { qty: 1, price: 1 });
  assert.equal(r.body.items[0].price, 1250);
  assert.equal(r.body.total, 1250);
});

test('removing an item and clearing the cart', async (t) => {
  const { client, put } = await setup(t);
  const guest = client();
  await put(guest, 'TK-001', 1);
  await put(guest, 'TK-002', 2);
  let r = await guest('/cart/items/TK-001', 'DELETE');
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.items.map((i) => i.id),
    ['TK-002'],
  );
  // Removing something that is not in the cart is not an error.
  r = await guest('/cart/items/TK-001', 'DELETE');
  assert.equal(r.status, 200);
  r = await guest('/cart', 'DELETE');
  assert.deepEqual(r.body, { items: [], total: 0 });
});

test('removing or clearing without a cart does not create one', async (t) => {
  const { db, client } = await setup(t);
  const guest = client();
  assert.equal((await guest('/cart/items/TK-001', 'DELETE')).status, 200);
  const r = await guest('/cart', 'DELETE');
  assert.equal(r.status, 200);
  assert(!r.setCookies.some((c) => c.startsWith('takistir_cart=')));
  const { rows } = await db.query('SELECT count(*)::int AS n FROM carts');
  assert.equal(rows[0].n, 0);
});

test('guests cannot see each other’s carts', async (t) => {
  const { client, put } = await setup(t);
  const a = client();
  const b = client();
  await put(a, 'TK-001', 1);
  await put(b, 'TK-002', 2);
  assert.deepEqual(
    (await a('/cart')).body.items.map((i) => i.id),
    ['TK-001'],
  );
  assert.deepEqual(
    (await b('/cart')).body.items.map((i) => i.id),
    ['TK-002'],
  );
});

test('an unknown or forged cart cookie is treated as an empty cart', async (t) => {
  const { client, put } = await setup(t);
  const guest = client();
  guest.jar.set('takistir_cart', 'forged-token');
  assert.deepEqual((await guest('/cart')).body, { items: [], total: 0 });
  assert.equal((await put(guest, 'TK-001', 1)).status, 200);
  assert.equal((await guest('/cart')).body.items.length, 1);
});

test('a customer cart is kept on the account across logins', async (t) => {
  const { customer, put } = await setup(t);
  const first = await customer();
  await put(first, 'TK-001', 2);
  await first('/auth/logout', 'POST', {});
  const later = await customer(); // a new session, e.g. another device
  const r = await later('/cart');
  assert.equal(r.body.items[0].qty, 2);
  assert.equal(r.body.total, 2500);
});

test('customers cannot see each other’s carts', async (t) => {
  const { client, customer, put } = await setup(t);
  const deniz = await customer();
  await put(deniz, 'TK-001', 1);
  const other = client();
  await other('/auth/register', 'POST', {
    email: 'other@example.com',
    name: 'Other',
    password: 'OtherPass!24',
  });
  assert.deepEqual((await other('/cart')).body.items, []);
  await put(other, 'TK-002', 1);
  assert.deepEqual(
    (await deniz('/cart')).body.items.map((i) => i.id),
    ['TK-001'],
  );
});

test('staff accounts have no cart', async (t) => {
  const { manager, put } = await setup(t);
  const pm = await manager();
  assert.equal((await pm('/cart')).status, 403);
  const r = await put(pm, 'TK-001', 1);
  assert.equal(r.status, 403);
  assert(!r.setCookies.some((c) => c.startsWith('takistir_cart=')));
});

test('items that became unavailable are flagged and left out of the total', async (t) => {
  const { db, client, put } = await setup(t);
  const guest = client();
  await put(guest, 'TK-001', 3);
  await put(guest, 'TK-002', 1);
  await put(guest, 'TK-003', 1);
  await db.query(
    "UPDATE products SET stock_quantity = 2 WHERE code = 'TK-001'",
  );
  await db.query("UPDATE products SET archived = TRUE WHERE code = 'TK-003'");
  const { items, total } = (await guest('/cart')).body;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId['TK-001'].available, false);
  assert.equal(byId['TK-001'].stock, 2);
  assert.equal(byId['TK-003'].available, false);
  assert.equal(byId['TK-003'].stock, 0);
  assert.equal(byId['TK-002'].available, true);
  assert.equal(total, 890);
});

test('adding to the cart does not reserve stock', async (t) => {
  const { db, client, put } = await setup(t);
  await put(client(), 'TK-003', 6);
  const { rows } = await db.query(
    "SELECT stock_quantity FROM products WHERE code = 'TK-003'",
  );
  assert.equal(rows[0].stock_quantity, 6);
  assert.equal((await put(client(), 'TK-003', 6)).status, 200);
});

test('guest carts expire after 30 days without changes', async (t) => {
  const { db, client, put } = await setup(t);
  const guest = client();
  await put(guest, 'TK-001', 1);
  await db.query("UPDATE carts SET updated_at = now() - interval '31 days'");
  assert.deepEqual((await guest('/cart')).body, { items: [], total: 0 });
  // The next addition starts a fresh cart with the same cookie.
  const r = await put(guest, 'TK-002', 1);
  assert.deepEqual(
    r.body.items.map((i) => i.id),
    ['TK-002'],
  );
  // A new guest arriving also removes other expired guest carts.
  const stale = client();
  await put(stale, 'TK-001', 1);
  await db.query(
    "UPDATE carts SET updated_at = now() - interval '40 days' WHERE id = (SELECT max(id) FROM carts)",
  );
  await put(client(), 'TK-001', 1);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM carts');
  assert.equal(rows[0].n, 2);
});

test('parallel first additions by one customer end up in a single cart', async (t) => {
  const { db, customer, put } = await setup(t);
  const deniz = await customer();
  const results = await Promise.all([
    put(deniz, 'TK-001', 1),
    put(deniz, 'TK-002', 1),
    put(deniz, 'TK-003', 1),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200, 200],
  );
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM carts WHERE customer_id = 'CU-001'",
  );
  assert.equal(rows[0].n, 1);
  assert.equal((await deniz('/cart')).body.items.length, 3);
});

test('the database enforces one owner per cart and positive quantities', async (t) => {
  const { db } = await setup(t);
  await assert.rejects(
    db.query(
      "INSERT INTO carts (customer_id, guest_token_hash) VALUES ('CU-001', repeat('a', 64))",
    ),
    { code: '23514' },
  );
  await assert.rejects(db.query('INSERT INTO carts DEFAULT VALUES'), {
    code: '23514',
  });
  const { rows } = await db.query(
    "INSERT INTO carts (customer_id) VALUES ('CU-001') RETURNING id",
  );
  await assert.rejects(
    db.query(
      'INSERT INTO cart_items (cart_id, product_id, quantity) SELECT $1, id, 0 FROM products LIMIT 1',
      [rows[0].id],
    ),
    { code: '23514' },
  );
});

test('cart changes need the request protection header', async (t) => {
  const { db } = await setup(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const res = await fetch(
    `http://127.0.0.1:${server.address().port}/api/cart/items/TK-001`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: 1 }),
    },
  );
  assert.equal(res.status, 403);
});
