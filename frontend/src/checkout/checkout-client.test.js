import test from 'node:test';
import assert from 'node:assert/strict';
import { createCartClient } from '../cart/cart-client.js';
import { createCheckoutClient } from './checkout-client.js';
import { cartQuote } from './model.js';

const address = {
  name: 'Deniz',
  street: 'Test Sokak',
  city: 'İstanbul',
  postcode: '34000',
};
const product = (fields = {}) => ({
  id: 'A',
  name: 'Necklace',
  price: 10,
  qty: 1,
  stock: 20,
  available: true,
  ...fields,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function setup(options = {}) {
  let user = { id: 'CU-001', role: 'customer' };
  let lines = options.items || [product()];
  const orders = new Map();
  const calls = [];
  let key = 0;
  const snapshot = () => ({
    items: structuredClone(lines),
    total: lines
      .filter((i) => i.available)
      .reduce((sum, i) => sum + i.qty * i.price, 0),
  });
  function commit(body) {
    if (orders.has(body.key)) return orders.get(body.key);
    const order = {
      id: `TK-${orders.size + 1}`,
      items: body.items.map((i) => ({
        ...lines.find((line) => line.id === i.id),
        qty: i.qty,
      })),
      address: body.address,
    };
    const result = { data: order.id, state: { user, orders: [order] } };
    orders.set(body.key, result);
    for (const paid of body.items) {
      const line = lines.find((i) => i.id === paid.id);
      line.stock -= paid.qty;
      line.available = line.qty <= line.stock;
    }
    return result;
  }
  const request = async (path, args = {}) => {
    calls.push({ path, ...args });
    await options.before?.(path, args);
    if (path === '/cart') return snapshot();
    if (path === '/orders')
      return options.post
        ? options.post(args.body, commit, {
            getLines: () => lines,
            setLines: (value) => {
              lines = value;
            },
          })
        : commit(args.body);
    const id = decodeURIComponent(path.split('/').at(-1));
    if (args.method === 'DELETE') lines = lines.filter((i) => i.id !== id);
    else
      lines = lines.map((i) =>
        i.id === id
          ? { ...i, qty: args.body.qty, available: args.body.qty <= i.stock }
          : i,
      );
    return snapshot();
  };
  const cart = createCartClient(request);
  cart.setOwner(user);
  await cart.refresh();
  const checkout = createCheckoutClient({
    request,
    cart,
    getUser: () => user,
    applyState: () => {},
    makeKey: () => `key-${++key}`,
  });
  return {
    cart,
    checkout,
    calls,
    orders,
    quote: () => cartQuote(cart.getSnapshot()),
    setLines: (value) => {
      lines = value;
    },
    setUser: (value) => {
      user = value;
      checkout.reset();
    },
  };
}

test('successful checkout sends only IDs/quantities/address/key and clears the purchased cart', async () => {
  const { cart, checkout, calls, orders, quote } = await setup();
  const result = await checkout.submit(
    { ...address, cardnumber: '4242', securitycode: '123' },
    quote(),
  );
  assert.equal(result.order.id, 'TK-1');
  assert.equal(orders.size, 1);
  assert.deepEqual(cart.getSnapshot().items, []);
  const body = calls.find((c) => c.path === '/orders').body;
  assert.deepEqual(body, {
    items: [{ id: 'A', qty: 1 }],
    address,
    key: 'key-1',
  });
});
test('an invalid delivery address does not send an order', async () => {
  const { checkout, calls, quote } = await setup();
  const result = await checkout.submit({ ...address, street: ' ' }, quote());
  assert(result.fieldErrors.street);
  assert(!calls.some((c) => c.path === '/orders'));
});
test('changed prices require explicit review before any order request', async () => {
  const { checkout, cart, calls, quote, setLines } = await setup();
  const reviewed = quote();
  setLines([product({ price: 15 })]);
  const result = await checkout.submit(address, reviewed);
  assert(result.reviewRequired);
  assert(!calls.some((c) => c.path === '/orders'));
  assert.equal(cart.getSnapshot().total, 15);
  checkout.acknowledgeReview();
  assert.equal(
    (await checkout.submit(address, quote())).order.items[0].price,
    15,
  );
});
test('stock loss during final cart refresh blocks checkout without dropping the line', async () => {
  const { checkout, cart, calls, quote, setLines } = await setup();
  const reviewed = quote();
  setLines([product({ stock: 0, available: false })]);
  const result = await checkout.submit(address, reviewed);
  assert.match(result.error, /Stock or availability/);
  assert.equal(cart.getSnapshot().items.length, 1);
  assert(!calls.some((c) => c.path === '/orders'));
});
test('HTTP stock rejection preserves the cart and is not treated as an uncertain purchase', async () => {
  const { checkout, cart, quote } = await setup({
    post: () => {
      const error = new Error('Stock changed');
      error.status = 409;
      throw error;
    },
  });
  const result = await checkout.submit(address, quote());
  assert.equal(result.uncertain, false);
  assert.equal(cart.getSnapshot().items.length, 1);
});
test('a lost successful response reuses the original key even after stock is exhausted', async () => {
  let first = true;
  const { checkout, cart, calls, orders, quote } = await setup({
    items: [product({ stock: 1 })],
    post: (body, commit) => {
      const response = commit(body);
      if (first) {
        first = false;
        throw new Error('Response lost');
      }
      return response;
    },
  });
  assert((await checkout.submit(address, quote())).uncertain);
  assert.equal(cart.getSnapshot().items[0].available, false);
  const result = await checkout.submit({ ...address, street: 'Changed' }, null);
  assert.equal(result.order.id, 'TK-1');
  assert.equal(orders.size, 1);
  const posts = calls.filter((c) => c.path === '/orders');
  assert.deepEqual(posts[0].body, posts[1].body);
  assert.deepEqual(cart.getSnapshot().items, []);
});
test('double-clicks during submission send exactly one order request', async () => {
  const gate = deferred();
  const { checkout, calls, quote } = await setup({
    post: async (body, commit) => {
      await gate.promise;
      return commit(body);
    },
  });
  const first = checkout.submit(address, quote());
  const second = await checkout.submit(address, quote());
  assert.match(second.error, /already being submitted/);
  gate.resolve();
  await first;
  assert.equal(calls.filter((c) => c.path === '/orders').length, 1);
});
test('cleanup failure never turns a confirmed order into a failed purchase', async () => {
  let fail = true;
  const { checkout, cart, calls, orders, quote } = await setup({
    before: (path, args) => {
      if (args.method === 'DELETE' && fail) throw new Error('Cleanup offline');
    },
  });
  const result = await checkout.submit(address, quote());
  assert(result.order);
  assert.match(result.cleanupError, /Cleanup offline/);
  await checkout.submit(address, quote());
  assert.equal(orders.size, 1);
  fail = false;
  await checkout.retryCleanup();
  assert.deepEqual(cart.getSnapshot().items, []);
  assert.equal(checkout.getSnapshot().cleanupError, '');
  assert.equal(calls.filter((c) => c.path === '/orders').length, 1);
});
test('unrelated products added while placing the order survive cleanup', async () => {
  const { checkout, cart, quote } = await setup({
    post: (body, commit, server) => {
      const response = commit(body);
      server.setLines([...server.getLines(), product({ id: 'B', price: 20 })]);
      return response;
    },
  });
  await checkout.submit(address, quote());
  assert.deepEqual(
    cart.getSnapshot().items.map((i) => i.id),
    ['B'],
  );
});
test('retrying partial cleanup does not subtract purchased quantities twice', async () => {
  let fail = true;
  const { checkout, cart, calls, quote } = await setup({
    items: [product({ qty: 2 }), product({ id: 'B' })],
    post: (body, commit, server) => {
      const response = commit(body);
      server.setLines(
        server.getLines().map((i) => (i.id === 'A' ? { ...i, qty: 4 } : i)),
      );
      return response;
    },
    before: (path, args) => {
      if (path === '/cart/items/B' && args.method === 'DELETE' && fail)
        throw new Error('Offline');
    },
  });
  await checkout.submit(address, quote());
  assert(checkout.getSnapshot().cleanupError);
  assert.equal(cart.getSnapshot().items.find((i) => i.id === 'A').qty, 2);
  fail = false;
  await checkout.retryCleanup();
  assert.deepEqual(
    cart.getSnapshot().items.map((i) => [i.id, i.qty]),
    [['A', 2]],
  );
  assert.equal(
    calls.filter((c) => c.path === '/cart/items/A' && c.method === 'PUT')
      .length,
    1,
  );
});
test('account changes invalidate in-flight checkout results without clearing another cart', async () => {
  const gate = deferred();
  const { checkout, calls, quote, setUser } = await setup({
    post: async (body, commit) => {
      const response = commit(body);
      await gate.promise;
      return response;
    },
  });
  const first = checkout.submit(address, quote());
  await new Promise((resolve) => setTimeout(resolve, 0));
  setUser({ id: 'CU-002', role: 'customer' });
  gate.resolve();
  assert((await first).error);
  assert.equal(checkout.getSnapshot().order, null);
  assert(!calls.some((c) => c.method === 'DELETE'));
});
test('a price race after preflight is reported using the confirmed server amount', async () => {
  const { checkout, quote } = await setup({
    post: (body, commit, server) => {
      server.setLines([product({ price: 12 })]);
      return commit(body);
    },
  });
  assert.equal(
    (await checkout.submit(address, quote())).order.items[0].price,
    12,
  );
  assert.match(checkout.getSnapshot().priceWarning, /different total/);
});
