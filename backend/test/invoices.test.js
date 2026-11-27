import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { freshDb, stopServer } from './postgres.js';
import { seedDemoData } from '../src/seed.js';
import { invoiceFor, placeOrder, view } from '../src/service.js';
import {
  claimInvoiceEmail,
  finishInvoiceEmail,
  loadInvoice,
  storeInvoice,
} from '../src/invoices.js';

after(stopServer);
const customer = { id: 'CU-001', role: 'customer' };
const checkout = {
  key: 'invoice-storage',
  items: [{ id: 'TK-001', qty: 2, price: 1 }],
  address: {
    name: 'Deniz',
    street: 'Demo 1',
    city: 'İstanbul',
    postcode: '34000',
  },
};
async function purchased(t) {
  const { db } = await freshDb(t);
  const id = await db.tx((c) => placeOrder(c, customer, checkout));
  return { db, id };
}

test('checkout captures an invoice and queues exactly one email across retries', async (t) => {
  const { db, id } = await purchased(t);
  assert.equal(await db.tx((c) => placeOrder(c, customer, checkout)), id);
  await db.tx((c) => storeInvoice(c, id));
  const invoice = await invoiceFor(db, customer, id);
  assert.equal(invoice.invoiceNumber, `TK-F-${id.replace('TK-', '')}`);
  assert.equal(invoice.customerEmail, 'deniz@example.com');
  assert.equal(invoice.customerName, 'Deniz Yılmaz');
  assert.equal(invoice.taxId, 'DEMO-001');
  assert.equal(invoice.total, 2500);
  assert.equal(invoice.currency, 'TRY');
  assert.equal(invoice.items[0].price, 1250);
  assert(!JSON.stringify(invoice).includes('unit_cost'));
  const { rows } = await db.query(
    'SELECT order_id, status, attempt_count FROM invoice_emails',
  );
  assert.deepEqual(rows, [
    { order_id: id, status: 'pending', attempt_count: 0 },
  ]);
});

test('invoice values survive profile, catalogue and source order edits', async (t) => {
  const { db, id } = await purchased(t);
  const original = await loadInvoice(db, id);
  await db.query(
    "UPDATE users SET name='Changed', email='changed@example.com', tax_id='Changed' WHERE id=$1",
    [customer.id],
  );
  await db.query(
    "UPDATE products SET name='Changed', price=1, archived=TRUE WHERE code='TK-001'",
  );
  await db.query(
    "UPDATE orders SET delivery_address='Changed', order_date='2000-01-01' WHERE id=$1",
    [id],
  );
  await db.query(
    'UPDATE order_items SET product_name=$2, unit_price=1 WHERE order_id=$1',
    [id, 'Changed'],
  );
  assert.deepEqual(await loadInvoice(db, id), original);
  const visible = await invoiceFor(db, customer, id);
  assert.equal(visible.customerName, original.customerName);
  assert.equal(visible.address, original.address);
  assert.equal(visible.date, original.date);
  assert.deepEqual(visible.items, original.items);
  const snapshot = await view(db, customer);
  const order = snapshot.orders.find((row) => row.id === id);
  assert.equal(order.customerName, original.customerName);
  assert.equal(order.customerEmail, original.customerEmail);
});

test('invoice access follows existing owner and manager authorization', async (t) => {
  const { db, id } = await purchased(t);
  await assert.rejects(invoiceFor(db, { id: 'other', role: 'customer' }, id), {
    status: 404,
  });
  await assert.rejects(invoiceFor(db, null, id), { status: 404 });
  const manager = await invoiceFor(
    db,
    { id: 'PM-001', role: 'product-manager' },
    id,
  );
  const sales = await invoiceFor(
    db,
    { id: 'SM-001', role: 'sales-manager' },
    id,
  );
  assert.equal(manager.invoiceNumber, sales.invoiceNumber);
});

test('email claims exclude competing workers and failed sends can be retried', async (t) => {
  const { db, id } = await purchased(t);
  const claims = await Promise.all([
    db.tx((c) => claimInvoiceEmail(c, id)),
    db.tx((c) => claimInvoiceEmail(c, id)),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const claim = claims.find(Boolean);
  assert.equal(claim.attempt_count, 1);
  const failed = await db.tx((c) =>
    finishInvoiceEmail(c, id, claim.claim_token, false),
  );
  assert.equal(failed.status, 'failed');
  assert.equal(failed.sent_at, null);
  const retry = await db.tx((c) => claimInvoiceEmail(c, id));
  assert.equal(retry.attempt_count, 2);
  assert.notEqual(retry.claim_token, claim.claim_token);
  const sent = await db.tx((c) =>
    finishInvoiceEmail(c, id, retry.claim_token, true),
  );
  assert.equal(sent.status, 'sent');
  assert(sent.sent_at);
  assert.equal(await db.tx((c) => claimInvoiceEmail(c, id)), null);
  assert.equal(
    await db.tx((c) => finishInvoiceEmail(c, id, claim.claim_token, false)),
    null,
  );
});

test('expired email leases recover and stale worker results cannot change state', async (t) => {
  const { db, id } = await purchased(t);
  const abandoned = await db.tx((c) => claimInvoiceEmail(c, id));
  await db.query(
    "UPDATE invoice_emails SET lease_until=now()-interval '1 second' WHERE order_id=$1",
    [id],
  );
  const recovered = await db.tx((c) => claimInvoiceEmail(c, id));
  assert.equal(recovered.attempt_count, 2);
  assert.equal(
    await db.tx((c) => finishInvoiceEmail(c, id, abandoned.claim_token, true)),
    null,
  );
  const result = await db.tx((c) =>
    finishInvoiceEmail(c, id, recovered.claim_token, true),
  );
  assert.equal(result.status, 'sent');
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM orders WHERE checkout_key=$1',
        [checkout.key],
      )
    ).rows[0].n,
    1,
  );
});

test('database rejects impossible email states and duplicate invoices', async (t) => {
  const { db, id } = await purchased(t);
  for (const status of ['sending', 'sent', 'unknown']) {
    await assert.rejects(
      db.query('UPDATE invoice_emails SET status=$2 WHERE order_id=$1', [
        id,
        status,
      ]),
      { code: '23514' },
    );
  }
  await assert.rejects(
    db.query('INSERT INTO invoices SELECT * FROM invoices WHERE order_id=$1', [
      id,
    ]),
    { code: '23505' },
  );
});

test('checkout rollback removes the invoice and email queue with the order', async (t) => {
  const { db } = await freshDb(t);
  const before = (await db.query('SELECT count(*)::int AS n FROM invoices'))
    .rows[0].n;
  await assert.rejects(
    db.tx(async (c) => {
      await placeOrder(c, customer, checkout);
      throw new Error('Simulated failure before commit');
    }),
    /Simulated failure/,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM invoices')).rows[0].n,
    before,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM invoice_emails')).rows[0].n,
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

test('migration captures existing accessory orders without queuing historical emails', async (t) => {
  const { db } = await freshDb(t, { migrate: false, seed: false });
  const dir = new URL('../db/migrations/', import.meta.url);
  const migration = '009_create_invoice_records.sql';
  const files = readdirSync(dir)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort();
  for (const file of files.filter((name) => name !== migration)) {
    await db.query(readFileSync(new URL(file, dir), 'utf8'));
  }
  await seedDemoData(db);
  await db.query(readFileSync(new URL(migration, dir), 'utf8'));
  const invoice = await invoiceFor(db, customer, 'TK-1024');
  assert.equal(invoice.invoiceNumber, 'TK-F-1024');
  assert.equal(invoice.customerEmail, 'deniz@example.com');
  assert.equal(invoice.items[0].price, 1450);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM invoice_emails')).rows[0].n,
    0,
  );
});
