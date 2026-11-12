import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../../backend/src/app.js';
import { freshDb, stopServer } from '../../../backend/test/postgres.js';
import { createCartClient } from '../cart/cart-client.js';
import { submitCredentials, signedInDestination } from './model.js';

after(stopServer);
const customer = { email: 'deniz@example.com', password: 'CustomerDemo!24' };

async function setup(t) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const jar = new Map();
  let state;
  const request = async (path, { method = 'GET', body, signal } = {}) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Takistir-Request': '1',
          Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      if (pair.slice(index + 1))
        jar.set(pair.slice(0, index), pair.slice(index + 1));
      else jar.delete(pair.slice(0, index));
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const cart = createCartClient(request);
  cart.setOwner(null);
  await cart.refresh();
  const mutate = async (path, method, body) => {
    try {
      const result = await request(path, { method, body });
      state = result.state;
      cart.setOwner(state.user);
      await cart.refresh();
      return { ...result, error: '' };
    } catch (error) {
      return { error: error.message };
    }
  };
  return {
    db,
    cart,
    request,
    mutate,
    state: () => state,
    signIn: (credentials = customer) => submitCredentials(credentials, mutate),
  };
}

test('frontend registration keeps the guest cart and returns a customer session', async (t) => {
  const { cart, signIn } = await setup(t);
  await cart.add('TK-002', 2);
  const result = await signIn({
    email: '  NEW@Example.com ',
    password: 'NewPassword!24',
    confirmation: 'NewPassword!24',
    name: ' New Customer ',
    home: '  İstanbul, Kadıköy  ',
  });
  assert.equal(result.error, '');
  assert.equal(result.state.user.email, 'new@example.com');
  assert.equal(result.state.user.role, 'customer');
  assert.equal(result.state.user.home, 'İstanbul, Kadıköy');
  assert.deepEqual(
    cart.getSnapshot().items.map((item) => [item.id, item.qty]),
    [['TK-002', 2]],
  );
  assert.match(result.notice, /1 guest-cart product saved/);
});

test('frontend login reports stock-capped merges and loads the actual merged quantity', async (t) => {
  const { cart, mutate, signIn } = await setup(t);
  await signIn();
  await cart.add('TK-003', 4);
  await mutate('/auth/logout', 'POST', {});
  await cart.add('TK-003', 5);
  const result = await signIn();
  assert.equal(cart.getSnapshot().items[0].qty, 6);
  assert.match(result.notice, /requested 9, kept 6/);
  assert.equal(cart.getSnapshot().total, 8700);
});

test('wrong-password and duplicate-registration failures preserve the guest cart', async (t) => {
  const { cart, signIn } = await setup(t);
  await cart.add('TK-001', 2);
  const failed = await signIn({ ...customer, password: 'WrongPassword!24' });
  assert.match(failed.error, /incorrect/);
  const duplicate = await signIn({
    ...customer,
    name: 'Deniz',
    confirmation: customer.password,
    home: 'İstanbul',
  });
  assert.match(duplicate.error, /already registered/);
  await cart.refresh();
  assert.equal(cart.getSnapshot().items[0].qty, 2);
  assert.equal(cart.getSnapshot().total, 2500);
});

test('a profile failure after registration preserves one valid account and its merged cart', async (t) => {
  const { db, cart, mutate } = await setup(t);
  await cart.add('TK-001', 2);
  const result = await submitCredentials(
    {
      email: 'partial@example.com',
      name: 'Partial Customer',
      password: 'PartialDemo!53',
      confirmation: 'PartialDemo!53',
      home: 'İstanbul',
    },
    async (path, ...args) =>
      path === '/profile'
        ? { error: 'Simulated profile outage' }
        : mutate(path, ...args),
  );
  assert.equal(result.error, '');
  assert.match(result.profileError, /address was not saved/);
  assert.equal(cart.getSnapshot().items[0].qty, 2);
  const rows = await db.query(
    "SELECT id FROM users WHERE email = 'partial@example.com'",
  );
  assert.equal(rows.rows.length, 1);
  const updated = await mutate('/profile', 'PATCH', {
    name: 'Partial Customer',
    email: 'partial@example.com',
    home: 'İstanbul',
  });
  assert.equal(updated.state.user.id, result.state.user.id);
  assert.equal(updated.state.user.home, 'İstanbul');
});

test('logout hides the account cart, and later login restores it', async (t) => {
  const { cart, mutate, signIn } = await setup(t);
  await signIn();
  await cart.add('TK-002', 2);
  await mutate('/auth/logout', 'POST', {});
  assert.deepEqual(cart.getSnapshot().items, []);
  await signIn();
  assert.equal(cart.getSnapshot().items[0].qty, 2);
});

test('staff login cannot consume a guest cart or enter customer checkout', async (t) => {
  const { cart, mutate, signIn } = await setup(t);
  await cart.add('TK-001');
  const result = await signIn({
    email: 'manager@takistir.local',
    password: 'ManagerDemo!24',
  });
  assert.equal(cart.getSnapshot().enabled, false);
  assert.equal(
    signedInDestination(result.state.user, '/checkout/delivery'),
    '/product-manager',
  );
  await mutate('/auth/logout', 'POST', {});
  assert.equal(cart.getSnapshot().items[0].id, 'TK-001');
});
