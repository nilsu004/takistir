// SCRUM-72: migrations, sample data and stock consistency.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { products as seedProducts } from '../../shared/seed.js';
import { freshDb, stopServer } from './postgres.js';

after(stopServer);

const checkSql = readFileSync(
  new URL('../db/checks/consistency.sql', import.meta.url),
  'utf8',
);
const migrationFiles = readdirSync(
  new URL('../db/migrations/', import.meta.url),
).filter((f) => f.endsWith('.sql'));

const address = {
  name: 'Deniz',
  street: 'Demo street 1',
  city: 'İstanbul',
  postcode: '34000',
};

/** Runs the consistency checks; returns the problems as "check ref" strings. */
async function problems(q) {
  const { rows } = await q.query(checkSql);
  return rows.map((r) => `${r.check_name} ${r.ref}`);
}

/** Runs fn inside a transaction that is always rolled back. */
async function rolledBack(db, fn) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

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
    assert.equal(
      (await call('/auth/login', 'POST', { email, password })).status,
      200,
    );
    return call;
  }
  return {
    db,
    customer: await login('deniz@example.com', 'CustomerDemo!24'),
    manager: await login('manager@takistir.local', 'ManagerDemo!24'),
    sales: await login('sales@takistir.local', 'SalesDemo!24'),
  };
}

const stockOf = async (db, code) =>
  (
    await db.query('SELECT stock_quantity FROM products WHERE code = $1', [
      code,
    ])
  ).rows[0].stock_quantity;

test('migration files are numbered uniquely and in sequence (no two 006s)', () => {
  const numbers = migrationFiles.map((f) => {
    assert.match(f, /^\d{3}_[a-z0-9_]+\.sql$/, `bad migration name: ${f}`);
    return Number(f.slice(0, 3));
  });
  numbers.sort((a, b) => a - b);
  assert.deepEqual(
    numbers,
    numbers.map((_, i) => i + 1),
    'migration numbers must be 001, 002, … without gaps or duplicates',
  );
});

test('a fresh database records every migration file exactly once', async (t) => {
  const { db } = await freshDb(t, { seed: false });
  const { rows } = await db.query(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  assert.deepEqual(
    rows.map((r) => r.version),
    [...migrationFiles].sort(),
  );
});

test('seeded demo data passes all consistency checks', async (t) => {
  const { db } = await freshDb(t);
  assert.deepEqual(await problems(db), []);
});

test('an empty migrated database passes all consistency checks', async (t) => {
  const { db } = await freshDb(t, { seed: false });
  assert.deepEqual(await problems(db), []);
});

test('seeded stock matches the sample data file and stays within limits', async (t) => {
  const { db } = await freshDb(t);
  const { rows } = await db.query(
    'SELECT code, stock_quantity, price FROM products ORDER BY code',
  );
  assert.equal(rows.length, seedProducts.length);
  for (const p of seedProducts) {
    const row = rows.find((r) => r.code === p.id);
    assert.ok(row, `${p.id} was not seeded`);
    assert.equal(row.stock_quantity, p.stock, `${p.id} stock`);
    assert.equal(row.price, p.price, `${p.id} price`);
  }
  // The demo needs both cases: something to buy and something out of stock.
  assert.ok(rows.some((r) => r.stock_quantity === 0));
  assert.ok(rows.some((r) => r.stock_quantity > 0));
});

test('stock ledger: seed stock − bought + cancelled + approved returns', async (t) => {
  const { db, customer, manager, sales } = await store(t);
  const codes = ['TK-001', 'TK-002'];
  const start = Object.fromEntries(
    await Promise.all(codes.map(async (c) => [c, await stockOf(db, c)])),
  );

  async function buy(items) {
    const r = await customer('/orders', 'POST', {
      key: randomUUID(),
      items,
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

  // A: delivered, two of three TK-001 returned and refunded.
  const a = await buy([
    { id: 'TK-001', qty: 3 },
    { id: 'TK-002', qty: 1 },
  ]);
  await deliver(a);
  const ret = await customer(`/orders/${a}/returns`, 'POST', {
    selected: { 'TK-001': 2 },
  });
  assert.equal(ret.status, 200);
  const returnId = ret.body.state.orders.find((o) => o.id === a).returnRequest
    .id;
  assert.equal(
    (
      await sales(`/sales/returns/${returnId}/receive`, 'POST', {
        confirmed: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await sales(`/sales/returns/${returnId}/approve`, 'POST', {})).status,
    200,
  );
  // Approving twice must not restock twice.
  await sales(`/sales/returns/${returnId}/approve`, 'POST', {});

  // B: cancelled while processing; cancelling twice must not restock twice.
  const b = await buy([{ id: 'TK-002', qty: 2 }]);
  assert.equal((await customer(`/orders/${b}/cancel`, 'POST')).status, 200);
  assert.notEqual((await customer(`/orders/${b}/cancel`, 'POST')).status, 200);

  // C: still processing. D: delivered and reviewed.
  await buy([{ id: 'TK-001', qty: 1 }]);
  const d = await buy([{ id: 'TK-002', qty: 1 }]);
  await deliver(d);
  assert.equal(
    (
      await customer('/reviews', 'POST', {
        productId: 'TK-002',
        rating: 5,
        comment: 'Lovely',
      })
    ).status,
    200,
  );

  // Expected stock computed from the database's own order history.
  const { rows } = await db.query(
    `SELECT p.code,
            COALESCE(SUM(oi.quantity) FILTER (WHERE o.status <> 'Cancelled'), 0)::INT AS sold,
            COALESCE((SELECT SUM(ri.quantity) FROM return_request_items ri
                      JOIN return_requests r ON r.id = ri.return_id
                      WHERE r.status = 'Approved' AND ri.product_id = p.id), 0)::INT AS returned
     FROM products p
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id AND o.inventory_reserved
     WHERE p.code = ANY($1)
     GROUP BY p.id, p.code`,
    [codes],
  );
  for (const r of rows)
    assert.equal(
      await stockOf(db, r.code),
      start[r.code] - r.sold + r.returned,
      `${r.code}: start ${start[r.code]}, sold ${r.sold}, returned ${r.returned}`,
    );
  // Concrete numbers for the reviewer: 12 − 3 − 1 + 2 = 10 and 8 − 1 − 1 = 6.
  assert.equal(await stockOf(db, 'TK-001'), start['TK-001'] - 2);
  assert.equal(await stockOf(db, 'TK-002'), start['TK-002'] - 2);

  assert.deepEqual(await problems(db), []);
});

test('each consistency check reports the broken row it is meant to catch', async (t) => {
  const { db } = await freshDb(t);
  const [{ id: productId }] = (
    await db.query("SELECT id FROM products WHERE code = 'TK-001'")
  ).rows;

  async function order(c, id, status, qty = 2) {
    await c.query(
      `INSERT INTO orders (id, customer_id, delivery_id, status, delivery_address)
       VALUES ($1, 'CU-001', $2, $3, 'Test address')`,
      [id, `DL-${id}`, status],
    );
    if (qty)
      await c.query(
        `INSERT INTO order_items (order_id, product_id, position, product_name,
           product_image, quantity, unit_price)
         VALUES ($1, $2, 0, 'Test', 'x.svg', $3, 100)`,
        [id, productId, qty],
      );
  }
  async function returnRequest(c, id, orderId, status, qty = 1) {
    await c.query(
      `INSERT INTO return_requests (id, order_id, status, amount)
       VALUES ($1, $2, $3, 0)`,
      [id, orderId, status],
    );
    await c.query(
      `INSERT INTO return_request_items (return_id, product_id, quantity)
       VALUES ($1, $2, $3)`,
      [id, productId, qty],
    );
  }
  const refund = (c, returnId, amount) =>
    c.query(
      `INSERT INTO refunds (return_id, amount, returned_cost, actor_id)
       VALUES ($1, $2, 0, 'SM-001')`,
      [returnId, amount],
    );

  const cases = {
    active_product_in_archived_category: async (c) => {
      await c.query(
        'UPDATE categories SET archived = TRUE WHERE id = (SELECT category_id FROM products WHERE id = $1)',
        [productId],
      );
    },
    order_without_items: (c) => order(c, 'T-EMPTY', 'Processing', 0),
    order_by_non_customer: async (c) => {
      await order(c, 'T-STAFF', 'Processing');
      await c.query(
        "UPDATE orders SET customer_id = 'PM-001' WHERE id = 'T-STAFF'",
      );
    },
    return_for_undelivered_order: async (c) => {
      await order(c, 'T-PROC', 'Processing');
      await returnRequest(c, 'R-PROC', 'T-PROC', 'Awaiting item');
    },
    return_item_not_in_order_or_too_many: async (c) => {
      await order(c, 'T-MANY', 'Delivered', 2);
      await returnRequest(c, 'R-MANY', 'T-MANY', 'Awaiting item', 5);
    },
    approved_return_without_refund: async (c) => {
      await order(c, 'T-NOREF', 'Delivered');
      await returnRequest(c, 'R-NOREF', 'T-NOREF', 'Approved');
    },
    refund_without_approved_return: async (c) => {
      await order(c, 'T-EARLY', 'Delivered');
      await returnRequest(c, 'R-EARLY', 'T-EARLY', 'Received');
      await refund(c, 'R-EARLY', 100);
    },
    refund_amount_mismatch: async (c) => {
      await order(c, 'T-AMT', 'Delivered');
      await returnRequest(c, 'R-AMT', 'T-AMT', 'Approved');
      await refund(c, 'R-AMT', 250); // paid 1 × 100
    },
    review_without_delivered_purchase: (c) =>
      c.query(
        `INSERT INTO reviews (id, product_id, customer_id, author_name, rating, comment, status)
         VALUES ('RV-X', $1, 'CU-001', 'Deniz', 5, 'Great', 'Approved')`,
        [productId],
      ),
    price_above_list_price: (c) =>
      c.query('UPDATE products SET price = list_price + 1 WHERE id = $1', [
        productId,
      ]),
  };

  const checkNames = [...checkSql.matchAll(/'([a-z_]+)'(?: AS check_name)?,/g)]
    .map((m) => m[1])
    .filter((n) => n.includes('_'));
  assert.deepEqual(
    [...new Set(checkNames)].sort(),
    Object.keys(cases).sort(),
    'every check in consistency.sql needs a case here',
  );

  for (const [name, breakIt] of Object.entries(cases))
    await t.test(name, () =>
      rolledBack(db, async (c) => {
        await breakIt(c);
        const found = (await problems(c)).filter((p) => p.startsWith(name));
        assert.ok(found.length >= 1, `${name} was not reported`);
      }),
    );

  // Nothing above was committed.
  assert.deepEqual(await problems(db), []);
});
