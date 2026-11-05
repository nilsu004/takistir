import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { freshDb, stopServer } from './postgres.js';

after(stopServer);

// SCRUM-52: signing in or registering keeps the guest cart.

const DENIZ = { email: 'deniz@example.com', password: 'CustomerDemo!24' };
const MANAGER = { email: 'manager@takistir.local', password: 'ManagerDemo!24' };

async function setup(t) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  // A browser-like client that keeps (and forgets) cookies like a browser.
  function browser() {
    const jar = new Map();
    const call = async (path, method = 'GET', body) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Takistir-Request': '1',
          ...(jar.size
            ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }
            : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair, ...attrs] = c.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const expired = attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a));
        if (expired || pair.slice(i + 1) === '') jar.delete(name);
        else jar.set(name, pair.slice(i + 1));
      }
      return { status: res.status, body: await res.json() };
    };
    call.jar = jar;
    call.add = (id, qty) => call(`/cart/items/${id}`, 'PUT', { qty });
    call.cart = async () => (await call('/cart')).body;
    call.login = (account) => call('/auth/login', 'POST', account);
    return call;
  }
  const lines = (cart) => cart.items.map((i) => [i.id, i.qty]);
  return { db, browser, lines };
}

test('items added as a guest are in the cart after signing in', async (t) => {
  const { db, browser, lines } = await setup(t);
  const b = browser();
  await b.add('TK-001', 2);
  await b.add('TK-003', 1);
  const login = await b.login(DENIZ);
  assert.equal(login.status, 200);
  assert.deepEqual(login.body.data, {
    cart: { merged: 2, adjusted: [], skipped: [] },
  });
  assert.deepEqual(lines(await b.cart()), [
    ['TK-001', 2],
    ['TK-003', 1],
  ]);
  // The guest cart and its cookie are gone; the items now belong to the account.
  assert(!b.jar.has('takistir_cart'));
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM carts WHERE guest_token_hash IS NOT NULL',
  );
  assert.equal(rows[0].n, 0);
});

test('the merged cart is the account cart on other devices too', async (t) => {
  const { browser, lines } = await setup(t);
  const laptop = browser();
  await laptop.add('TK-002', 1);
  await laptop.login(DENIZ);
  const phone = browser();
  await phone.login(DENIZ);
  assert.deepEqual(lines(await phone.cart()), [['TK-002', 1]]);
});

test('a product in both carts gets the sum of the quantities', async (t) => {
  const { browser, lines } = await setup(t);
  const before = browser();
  await before.login(DENIZ);
  await before.add('TK-001', 2);
  await before('/auth/logout', 'POST', {});
  const b = browser();
  await b.add('TK-001', 3);
  await b.add('TK-002', 1);
  const login = await b.login(DENIZ);
  assert.deepEqual(login.body.data.cart.adjusted, []);
  assert.deepEqual(lines(await b.cart()), [
    ['TK-001', 5],
    ['TK-002', 1],
  ]);
});

test('a summed quantity above the stock is capped and reported', async (t) => {
  const { browser, lines } = await setup(t);
  const earlier = browser();
  await earlier.login(DENIZ);
  await earlier.add('TK-003', 4); // 6 in stock
  const b = browser();
  await b.add('TK-003', 5);
  const login = await b.login(DENIZ);
  assert.deepEqual(login.body.data.cart.adjusted, [
    { id: 'TK-003', requested: 9, qty: 6 },
  ]);
  assert.deepEqual(lines(await b.cart()), [['TK-003', 6]]);
  assert.equal((await b.cart()).items[0].available, true);
});

test('items that became unavailable are kept and marked, not lost', async (t) => {
  const { db, browser } = await setup(t);
  const b = browser();
  await b.add('TK-001', 1);
  await b.add('TK-002', 2);
  await b.add('TK-003', 1);
  await db.query(
    "UPDATE products SET stock_quantity = 0 WHERE code = 'TK-001'",
  );
  await db.query("UPDATE products SET archived = TRUE WHERE code = 'TK-002'");
  await db.query("UPDATE products SET price = NULL WHERE code = 'TK-003'");
  await b.login(DENIZ);
  const cart = await b.cart();
  assert.deepEqual(
    cart.items.map((i) => [i.id, i.qty, i.available]),
    [
      ['TK-001', 1, false],
      ['TK-002', 2, false],
      ['TK-003', 1, false],
    ],
  );
  assert.equal(cart.total, 0);
});

test('registering keeps the guest cart in the new account', async (t) => {
  const { browser, lines } = await setup(t);
  const b = browser();
  await b.add('TK-002', 2);
  const r = await b('/auth/register', 'POST', {
    email: 'new@example.com',
    name: 'New Customer',
    password: 'NewPass!24',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.cart.merged, 1);
  assert.deepEqual(lines(await b.cart()), [['TK-002', 2]]);
});

test('signing in without a guest cart changes nothing and sets no cart cookie', async (t) => {
  const { browser, lines } = await setup(t);
  const first = browser();
  await first.login(DENIZ);
  await first.add('TK-001', 1);
  const b = browser();
  const login = await b.login(DENIZ);
  assert.equal(login.body.data, null);
  assert(!b.jar.has('takistir_cart'));
  assert.deepEqual(lines(await b.cart()), [['TK-001', 1]]);
});

test('a failed sign-in keeps the guest cart untouched', async (t) => {
  const { browser, lines } = await setup(t);
  const b = browser();
  await b.add('TK-001', 1);
  const failed = await b.login({ ...DENIZ, password: 'wrong-password' });
  assert.equal(failed.status, 401);
  assert(b.jar.has('takistir_cart'));
  assert.deepEqual(lines(await b.cart()), [['TK-001', 1]]);
});

test('staff sign-in does not take the guest cart', async (t) => {
  const { browser, lines } = await setup(t);
  const b = browser();
  await b.add('TK-001', 1);
  const login = await b.login(MANAGER);
  assert.equal(login.body.data, null);
  await b('/auth/logout', 'POST', {});
  // Back as a guest in the same browser, the cart is still there.
  assert.deepEqual(lines(await b.cart()), [['TK-001', 1]]);
});

test('after signing out, the guest cart is empty (the account cart stays private)', async (t) => {
  const { browser, lines } = await setup(t);
  const b = browser();
  await b.add('TK-001', 1);
  await b.login(DENIZ);
  await b('/auth/logout', 'POST', {});
  assert.deepEqual(await b.cart(), { items: [], total: 0 });
  await b.login(DENIZ);
  assert.deepEqual(lines(await b.cart()), [['TK-001', 1]]);
});

test('an old cart cookie cannot merge the same items twice', async (t) => {
  const { browser, lines } = await setup(t);
  const b = browser();
  await b.add('TK-001', 2);
  const oldCookie = b.jar.get('takistir_cart');
  await b.login(DENIZ);
  await b('/auth/logout', 'POST', {});
  b.jar.set('takistir_cart', oldCookie);
  const again = await b.login(DENIZ);
  assert.deepEqual(again.body.data.cart.merged, 0);
  assert.deepEqual(lines(await b.cart()), [['TK-001', 2]]);
});

test('an expired guest cart is not merged', async (t) => {
  const { db, browser } = await setup(t);
  const b = browser();
  await b.add('TK-001', 1);
  await db.query("UPDATE carts SET updated_at = now() - interval '31 days'");
  const login = await b.login(DENIZ);
  assert.equal(login.body.data.cart.merged, 0);
  assert.deepEqual(await b.cart(), { items: [], total: 0 });
});

test('another browser’s guest cart is never merged into my account', async (t) => {
  const { browser, lines } = await setup(t);
  const stranger = browser();
  await stranger.add('TK-003', 1);
  const me = browser();
  await me.add('TK-001', 1);
  await me.login(DENIZ);
  assert.deepEqual(lines(await me.cart()), [['TK-001', 1]]);
  assert.deepEqual(lines(await stranger.cart()), [['TK-003', 1]]);
});

test('guest carts from two browsers merge into one account one after another', async (t) => {
  const { browser, lines } = await setup(t);
  const a = browser();
  const b = browser();
  await a.add('TK-001', 1);
  await b.add('TK-001', 2);
  await b.add('TK-002', 1);
  await a.login(DENIZ);
  await b.login(DENIZ);
  assert.deepEqual(lines(await a.cart()), [
    ['TK-001', 3],
    ['TK-002', 1],
  ]);
});

test('the merged cart can be checked out with the server prices', async (t) => {
  const { browser } = await setup(t);
  const b = browser();
  await b.add('TK-001', 1);
  await b.add('TK-002', 1);
  await b.login(DENIZ);
  const cart = await b.cart();
  assert.equal(cart.total, 1250 + 890);
  const order = await b('/orders', 'POST', {
    key: 'merged-cart',
    items: cart.items.map((i) => ({ id: i.id, qty: i.qty })),
    address: {
      name: 'Deniz',
      street: 'Demo street 1',
      city: 'İstanbul',
      postcode: '34000',
    },
  });
  assert.equal(order.status, 200);
});
