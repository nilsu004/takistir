import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../../backend/src/app.js';
import { freshDb, stopServer } from '../../../backend/test/postgres.js';
import { createCartClient } from '../cart/cart-client.js';
import { createCheckoutClient } from './checkout-client.js';
import { cartQuote } from './model.js';

after(stopServer);
const address = {
  name: 'Deniz',
  street: 'Test Sokak 56',
  city: 'İstanbul',
  postcode: '34000',
};
async function setup(t, options = {}) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const cookies = new Map();
  const calls = [];
  let user;
  const request = async (path, { method = 'GET', body, signal } = {}) => {
    calls.push({ path, method, body });
    await options.before?.(path, { method, body });
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Takistir-Request': '1',
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const i = pair.indexOf('=');
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error);
      error.status = response.status;
      throw error;
    }
    await options.after?.(path, result);
    return result;
  };
  const signedIn = await request('/auth/login', {
    method: 'POST',
    body: { email: 'deniz@example.com', password: 'CustomerDemo!24' },
  });
  user = signedIn.state.user;
  const cart = createCartClient(request);
  cart.setOwner(user);
  await cart.refresh();
  const checkout = createCheckoutClient({
    request,
    cart,
    getUser: () => user,
    applyState: (state) => {
      user = state.user;
    },
  });
  return {
    db,
    cart,
    checkout,
    calls,
    quote: () => cartQuote(cart.getSnapshot()),
  };
}

test('real checkout confirms purchase-time prices/address, decreases stock and empties paid cart lines', async (t) => {
  const { db, cart, checkout, calls, quote } = await setup(t);
  await cart.add('TK-001', 2);
  const result = await checkout.submit(
    {
      ...address,
      street: '  Test Sokak 56  ',
      cardnumber: '4242424242424242',
      securitycode: '123',
    },
    quote(),
  );
  assert.equal(result.error, '');
  assert.equal(result.order.items[0].price, 1250);
  assert.match(result.order.address, /Test Sokak 56/);
  assert.equal(
    (await db.query("SELECT stock_quantity FROM products WHERE code='TK-001'"))
      .rows[0].stock_quantity,
    10,
  );
  assert.deepEqual(cart.getSnapshot().items, []);
  assert.deepEqual(
    Object.keys(calls.find((c) => c.path === '/orders').body).sort(),
    ['address', 'items', 'key'],
  );
  assert.deepEqual(
    calls.find((c) => c.path === '/orders').body.address,
    address,
  );
});
test('real stock changes before payment block ordering and leave the cart visible', async (t) => {
  const { db, cart, checkout, calls, quote } = await setup(t);
  await cart.add('TK-003', 2);
  const reviewed = quote();
  await db.query("UPDATE products SET stock_quantity=1 WHERE code='TK-003'");
  const result = await checkout.submit(address, reviewed);
  assert.match(result.error, /Stock or availability/);
  assert.equal(cart.getSnapshot().items[0].qty, 2);
  assert.equal(cart.getSnapshot().items[0].available, false);
  assert(!calls.some((c) => c.path === '/orders'));
});
test('real price changes require a reviewed quote before using the new price', async (t) => {
  const { db, cart, checkout, calls, quote } = await setup(t);
  await cart.add('TK-001');
  const reviewed = quote();
  await db.query("UPDATE products SET price=1300 WHERE code='TK-001'");
  assert((await checkout.submit(address, reviewed)).reviewRequired);
  assert(!calls.some((c) => c.path === '/orders'));
  checkout.acknowledgeReview();
  assert.equal(
    (await checkout.submit(address, quote())).order.items[0].price,
    1300,
  );
});
test('a lost real success response is retried with the same key and never reserves stock twice', async (t) => {
  let lose = true;
  const { db, cart, checkout, calls, quote } = await setup(t, {
    after: (path) => {
      if (path === '/orders' && lose) {
        lose = false;
        throw new Error('Simulated lost response');
      }
    },
  });
  await cart.add('TK-003', 6);
  assert((await checkout.submit(address, quote())).uncertain);
  assert.equal(cart.getSnapshot().items[0].available, false);
  const result = await checkout.submit(address, null);
  assert(result.order);
  const posts = calls.filter((c) => c.path === '/orders');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.key, posts[1].body.key);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM orders WHERE checkout_key=$1',
        [posts[0].body.key],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("SELECT stock_quantity FROM products WHERE code='TK-003'"))
      .rows[0].stock_quantity,
    0,
  );
  assert.deepEqual(cart.getSnapshot().items, []);
});
test('real cart cleanup can be retried independently after the order was confirmed', async (t) => {
  let fail = true;
  const { cart, checkout, calls, quote } = await setup(t, {
    before: (path, { method }) => {
      if (path.startsWith('/cart/items/') && method === 'DELETE' && fail)
        throw new Error('Simulated cleanup outage');
    },
  });
  await cart.add('TK-001');
  const result = await checkout.submit(address, quote());
  assert(result.order);
  assert(result.cleanupError);
  fail = false;
  await checkout.retryCleanup();
  assert.deepEqual(cart.getSnapshot().items, []);
  assert.equal(calls.filter((c) => c.path === '/orders').length, 1);
});
