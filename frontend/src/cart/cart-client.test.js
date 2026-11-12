import test from 'node:test';
import assert from 'node:assert/strict';
import { createCartClient } from './cart-client.js';

const item = (fields = {}) => ({
  id: 'TK-001',
  name: 'Necklace',
  image: 'necklace-card.svg',
  qty: 1,
  stock: 12,
  price: 1250,
  available: true,
  ...fields,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function loaded(request, cart = { items: [item()], total: 1250 }) {
  const calls = [];
  const client = createCartClient(async (path, options = {}) => {
    calls.push({ path, ...options });
    return request ? request(path, options) : cart;
  });
  client.setOwner(null);
  await client.refresh();
  return { client, calls };
}

test('the initial guest cart is empty until the API loads; API totals and unavailable lines are retained', async () => {
  const client = createCartClient(async () => ({
    items: [
      item(),
      item({ id: 'TK-002', price: null, stock: 0, available: false }),
    ],
    total: 123.45,
  }));
  client.setOwner(null);
  assert.deepEqual(client.getSnapshot().items, []);
  assert.equal(client.getSnapshot().ready, false);
  await client.refresh();
  assert.equal(client.getSnapshot().total, 123.45);
  assert.equal(client.getSnapshot().items.length, 2);
  assert.equal(client.getSnapshot().items[1].price, null);
});

test('adding sends the existing quantity plus the requested quantity, without a client price', async () => {
  const { client, calls } = await loaded((path, options) =>
    options.method
      ? { items: [item({ qty: 3 })], total: 3750 }
      : { items: [item()], total: 1250 },
  );
  assert.equal((await client.add('TK-001', 2)).error, '');
  assert.equal(calls[1].path, '/cart/items/TK-001');
  assert.equal(calls[1].method, 'PUT');
  assert.deepEqual(calls[1].body, { qty: 3 });
  assert.equal(client.getSnapshot().total, 3750);
});

test('quantity changes replace quantities, while zero removes and clearing empties via DELETE', async () => {
  const { client, calls } = await loaded((path, options) =>
    options.method === 'DELETE'
      ? { items: [], total: 0 }
      : { items: [item()], total: 1250 },
  );
  await client.setQuantity('TK-001', 2);
  assert.deepEqual(calls[1].body, { qty: 2 });
  await client.setQuantity('TK-001', 0);
  assert.equal(calls[2].method, 'DELETE');
  assert.equal(calls[2].body, undefined);
  await client.clear();
  assert.equal(calls[3].path, '/cart');
  assert.equal(calls[3].method, 'DELETE');
  assert.deepEqual(client.getSnapshot().items, []);
});

test('invalid quantities do not reach the server', async () => {
  const { client, calls } = await loaded();
  for (const qty of [-1, 1.5, '2', NaN, Infinity])
    assert((await client.setQuantity('TK-001', qty)).error);
  assert((await client.add('TK-001', 0)).error);
  assert.equal(calls.length, 1);
});

test('a stock rejection retains the error and reloads authoritative availability', async () => {
  let reads = 0;
  const { client, calls } = await loaded((path, options) => {
    if (options.method) throw new Error('Only 1 left in stock.');
    reads += 1;
    return {
      items: [
        item({ qty: 2, stock: reads === 1 ? 12 : 1, available: reads === 1 }),
      ],
      total: reads === 1 ? 2500 : 0,
    };
  });
  const result = await client.setQuantity('TK-001', 3);
  assert.match(result.error, /Only 1/);
  assert.equal(calls.length, 3);
  assert.equal(client.getSnapshot().items[0].qty, 2);
  assert.equal(client.getSnapshot().items[0].available, false);
  assert.equal(client.getSnapshot().total, 0);
  assert.match(client.getSnapshot().error, /Only 1/);
  assert.equal(client.getSnapshot().pending, false);
});

test('a lost write response is reconciled by reading, without replaying the addition', async () => {
  let writes = 0;
  const { client } = await loaded((path, options) => {
    if (options.method) {
      writes += 1;
      throw new Error('Network disconnected.');
    }
    return {
      items: [item({ qty: writes ? 2 : 1 })],
      total: writes ? 2500 : 1250,
    };
  });
  await client.add('TK-001');
  assert.equal(writes, 1);
  assert.equal(client.getSnapshot().items[0].qty, 2);
  assert.equal(client.getSnapshot().syncError, '');
});

test('concurrent writes are blocked so first guest additions cannot create separate cookies', async () => {
  const write = deferred();
  const { client, calls } = await loaded((path, options) =>
    options.method ? write.promise : { items: [], total: 0 },
  );
  const first = client.add('TK-001');
  assert.equal(client.getSnapshot().pending, true);
  assert((await client.add('TK-002')).error);
  assert.equal(calls.length, 2);
  write.resolve({ items: [item()], total: 1250 });
  await first;
  assert.equal(client.getSnapshot().pending, false);
  assert.equal(client.getSnapshot().items.length, 1);
});

test('a delayed poll cannot overwrite a successful quantity update', async () => {
  const poll = deferred();
  let reads = 0;
  const { client } = await loaded((path, options) => {
    if (options.method) return { items: [item({ qty: 2 })], total: 2500 };
    reads += 1;
    return reads === 1 ? { items: [item()], total: 1250 } : poll.promise;
  });
  const refresh = client.refresh();
  await client.setQuantity('TK-001', 2);
  poll.resolve({ items: [item()], total: 1250 });
  await refresh;
  assert.equal(client.getSnapshot().items[0].qty, 2);
  assert.equal(client.getSnapshot().total, 2500);
});

test('switching accounts immediately hides the old cart and discards its delayed response', async () => {
  const old = deferred();
  let reads = 0;
  const { client } = await loaded(() => {
    reads += 1;
    return reads === 2
      ? old.promise
      : { items: reads === 1 ? [item()] : [], total: reads === 1 ? 1250 : 0 };
  });
  const refresh = client.refresh();
  client.setOwner({ id: 'CU-002', role: 'customer' });
  assert.deepEqual(client.getSnapshot().items, []);
  assert.equal(client.getSnapshot().ready, false);
  await client.refresh();
  old.resolve({ items: [item()], total: 1250 });
  await refresh;
  assert.deepEqual(client.getSnapshot().items, []);
});

test('a previous account mutation cannot replace the new account cart', async () => {
  const write = deferred();
  const { client } = await loaded((path, options) =>
    options.method ? write.promise : { items: [item()], total: 1250 },
  );
  const update = client.add('TK-001');
  client.setOwner({ id: 'CU-002', role: 'customer' });
  write.resolve({ items: [item({ qty: 2 })], total: 2500 });
  assert((await update).error);
  assert.deepEqual(client.getSnapshot().items, []);
  assert.equal(client.getSnapshot().pending, false);
});

test('staff accounts never request a cart and cannot modify it', async () => {
  const { client, calls } = await loaded();
  client.setOwner({ id: 'PM-001', role: 'product-manager' });
  await client.refresh();
  assert((await client.add('TK-001')).error);
  assert((await client.clear()).error);
  assert.deepEqual(client.getSnapshot().items, []);
  assert.equal(calls.length, 1);
});

test('initial load failure remains distinct from an empty cart and retry can recover', async () => {
  let offline = true;
  const client = createCartClient(async () => {
    if (offline) throw new Error('Cannot reach the API.');
    return { items: [], total: 0 };
  });
  client.setOwner(null);
  await client.refresh();
  assert.equal(client.getSnapshot().ready, false);
  assert.match(client.getSnapshot().syncError, /Cannot reach/);
  offline = false;
  await client.refresh({ clearError: true });
  assert.equal(client.getSnapshot().ready, true);
  assert.equal(client.getSnapshot().syncError, '');
});

test('a failed background refresh preserves the previous cart and marks it stale', async () => {
  let offline = false;
  const { client } = await loaded(() => {
    if (offline) throw new Error('Offline');
    return { items: [item()], total: 1250 };
  });
  offline = true;
  await client.refresh();
  assert.equal(client.getSnapshot().total, 1250);
  assert.equal(client.getSnapshot().ready, true);
  assert.equal(client.getSnapshot().syncError, 'Offline');
});

test('disposing aborts obsolete reads and allows a clean refresh after React effect remount', async () => {
  const old = deferred();
  let calls = 0;
  const client = createCartClient(async () =>
    ++calls === 1 ? old.promise : { items: [], total: 0 },
  );
  client.setOwner(null);
  const first = client.refresh();
  client.dispose();
  await client.refresh();
  old.resolve({ items: [item()], total: 1250 });
  await first;
  assert.deepEqual(client.getSnapshot().items, []);
  assert.equal(client.getSnapshot().loading, false);
});
