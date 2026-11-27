import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, stopServer } from './postgres.js';
import { placeOrder } from '../src/service.js';
import { recordMockPayment } from '../src/mock-payments.js';

after(stopServer);
const customer = { id: 'CU-001', role: 'customer' };
const checkout = {
  key: 'payment-storage',
  items: [{ id: 'TK-001', qty: 2, price: 1 }],
  address: {
    name: 'Deniz',
    street: 'Demo 1',
    city: 'İstanbul',
    postcode: '34000',
  },
};
const failure = {
  customerId: customer.id,
  checkoutKey: checkout.key,
  attemptKey: 'declined-1',
  outcome: 'failed',
  amount: 2500,
};

test('checkout stores one successful payment using purchase prices and safe fields', async (t) => {
  const { db } = await freshDb(t);
  const id = await db.tx((c) => placeOrder(c, customer, checkout));
  const retried = await db.tx((c) => placeOrder(c, customer, checkout));
  assert.equal(retried, id);
  const { rows } = await db.query('SELECT * FROM mock_payment_attempts');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].order_id, id);
  assert.equal(rows[0].amount, 2500);
  assert.equal(rows[0].outcome, 'succeeded');
  assert.equal(rows[0].currency, 'TRY');
  assert.equal(
    (await db.query("SELECT stock_quantity FROM products WHERE code='TK-001'"))
      .rows[0].stock_quantity,
    10,
  );
});

test('failed payment records are idempotent and never change orders or inventory', async (t) => {
  const { db } = await freshDb(t);
  const before = (await db.query('SELECT count(*)::int AS n FROM orders'))
    .rows[0].n;
  const first = await db.tx((c) =>
    recordMockPayment(c, {
      ...failure,
      cardNumber: '4111111111111111',
      securitycode: '123',
    }),
  );
  const repeated = await db.tx((c) => recordMockPayment(c, failure));
  assert.equal(repeated.id, first.id);
  const rows = (await db.query('SELECT * FROM mock_payment_attempts')).rows;
  assert.equal(rows.length, 1);
  assert(!JSON.stringify(rows).includes('4111111111111111'));
  assert(
    !Object.keys(rows[0]).some((key) => /card|security|password/i.test(key)),
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,
    before,
  );
  assert.equal(
    (await db.query("SELECT stock_quantity FROM products WHERE code='TK-001'"))
      .rows[0].stock_quantity,
    12,
  );
});

test('a failed attempt can be followed by a success, but its key cannot change meaning', async (t) => {
  const { db } = await freshDb(t);
  await db.tx((c) => recordMockPayment(c, failure));
  await assert.rejects(
    db.tx((c) => recordMockPayment(c, { ...failure, amount: 1 })),
    { status: 409 },
  );
  await db.tx((c) => placeOrder(c, customer, checkout));
  assert.deepEqual(
    (
      await db.query(
        'SELECT outcome FROM mock_payment_attempts ORDER BY outcome',
      )
    ).rows.map((r) => r.outcome),
    ['failed', 'succeeded'],
  );
});

test('payment success cannot be attached to a different customer or checkout', async (t) => {
  const { db } = await freshDb(t);
  const id = await db.tx((c) => placeOrder(c, customer, checkout));
  await assert.rejects(
    db.tx((c) =>
      recordMockPayment(c, {
        customerId: 'PM-001',
        checkoutKey: checkout.key,
        attemptKey: 'wrong-owner',
        outcome: 'succeeded',
        orderId: id,
      }),
    ),
    { code: '23503' },
  );
  await assert.rejects(
    db.tx((c) =>
      recordMockPayment(c, {
        customerId: customer.id,
        checkoutKey: 'different-checkout',
        attemptKey: 'wrong-checkout',
        outcome: 'succeeded',
        orderId: id,
      }),
    ),
    { code: '23503' },
  );
  await assert.rejects(
    db.tx((c) =>
      recordMockPayment(c, {
        customerId: customer.id,
        checkoutKey: checkout.key,
        attemptKey: 'second-success',
        outcome: 'succeeded',
        orderId: id,
      }),
    ),
    { code: '23505' },
  );
});

test('database constraints reject invalid payment outcomes and amounts', async (t) => {
  const { db } = await freshDb(t);
  for (const amount of [-1, 'NaN', 'Infinity']) {
    await assert.rejects(
      db.tx((c) => recordMockPayment(c, { ...failure, amount })),
      { code: /23514|22003/ },
    );
  }
  await assert.rejects(
    db.tx((c) => recordMockPayment(c, { ...failure, outcome: 'unknown' })),
    { code: '23514' },
  );
  await assert.rejects(
    db.tx((c) => recordMockPayment(c, { ...failure, checkoutKey: '' })),
    { code: '23514' },
  );
});

test('a rolled-back checkout leaves no payment record, order or stock reduction', async (t) => {
  const { db } = await freshDb(t);
  await assert.rejects(
    db.tx(async (c) => {
      await placeOrder(c, customer, checkout);
      throw new Error('Simulated failure before commit');
    }),
    /Simulated failure/,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM mock_payment_attempts'))
      .rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query('SELECT id FROM orders WHERE checkout_key=$1', [
        checkout.key,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query("SELECT stock_quantity FROM products WHERE code='TK-001'"))
      .rows[0].stock_quantity,
    12,
  );
});
