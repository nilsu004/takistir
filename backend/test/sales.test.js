import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { freshDb, stopServer } from './postgres.js';
import { seedDemoData } from '../src/seed.js';
after(stopServer);
const day = () => new Date().toISOString().slice(0, 10);
const range = (date = day()) => `/sales/workspace?from=${date}&to=${date}`;
const address = {
  name: 'Deniz',
  street: 'Demo street 1',
  city: 'İstanbul',
  postcode: '34000',
};
async function fixture(t) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  function client() {
    let cookie = '';
    return async (path, method = 'GET', body) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Takistir-Request': '1',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, body: await response.json() };
    };
  }
  const sales = client(),
    customer = client(),
    manager = client(),
    guest = client();
  for (const [c, email, password] of [
    [sales, 'sales@takistir.local', 'SalesDemo!24'],
    [customer, 'deniz@example.com', 'CustomerDemo!24'],
    [manager, 'manager@takistir.local', 'ManagerDemo!24'],
  ])
    assert.equal(
      (await c('/auth/login', 'POST', { email, password })).status,
      200,
    );
  async function pricing(price, cost = null, code = 'TK-001') {
    const r = await sales(`/sales/products/${code}/pricing`, 'PATCH', {
      price,
      cost,
    });
    assert.equal(r.status, 200);
    return r;
  }
  async function buy(qty = 1, code = 'TK-001') {
    const r = await customer('/orders', 'POST', {
      key: randomUUID(),
      items: [{ id: code, qty }],
      address,
    });
    assert.equal(r.status, 200);
    return r.body.data;
  }
  async function returnFor(order, qty = 1, code = 'TK-001') {
    await db.query("UPDATE orders SET status='Delivered' WHERE id=$1", [order]);
    const r = await customer(`/orders/${order}/returns`, 'POST', {
      selected: { [code]: qty },
    });
    assert.equal(r.status, 200);
    return r.body.state.orders.find((o) => o.id === order).returnRequest.id;
  }
  return {
    db,
    sales,
    customer,
    manager,
    guest,
    client,
    pricing,
    buy,
    returnFor,
  };
}
test('sales role gates pricing, campaigns, financial data and return decisions', async (t) => {
  const { sales, customer, manager, guest } = await fixture(t);
  for (const c of [customer, manager, guest]) {
    const status = c === guest ? 401 : 403;
    assert.equal((await c(range())).status, status);
    assert.equal(
      (
        await c('/sales/products/TK-001/pricing', 'PATCH', {
          price: 10,
          cost: 0,
        })
      ).status,
      status,
    );
    assert.equal(
      (
        await c('/sales/discounts', 'POST', {
          ids: ['TK-001'],
          percent: 10,
          key: 'x',
        })
      ).status,
      status,
    );
    assert.equal(
      (await c('/sales/returns/unknown/approve', 'POST', {})).status,
      status,
    );
  }
  assert.equal((await sales(range())).status, 200);
  assert.equal(
    (await sales('/manager/products/TK-001/stock', 'PATCH', { stock: 1 }))
      .status,
    403,
  );
  assert.equal(
    (
      await customer('/auth/register', 'POST', {
        email: 'bad@example.com',
        name: 'Bad',
        password: 'Password!24',
        role: 'sales-manager',
      })
    ).status,
    403,
  );
});
test('sale-time price/cost snapshots survive later pricing and retain explicit zero cost', async (t) => {
  const { db, sales, customer, guest, pricing, buy } = await fixture(t);
  await pricing(100, 0);
  const id = await buy(2);
  await pricing(500, 400);
  const stored = (
    await db.query(
      'SELECT unit_price,unit_cost FROM order_items WHERE order_id=$1',
      [id],
    )
  ).rows[0];
  assert.deepEqual(stored, { unit_price: 100, unit_cost: 0 });
  const invoice = await sales(`/orders/${id}/invoice`);
  assert.equal(invoice.status, 200);
  assert.equal(invoice.body.items[0].price, 100);
  assert.equal(invoice.body.customerName, 'Deniz Yılmaz');
  assert(!JSON.stringify(invoice.body).includes('unit_cost'));
  for (const c of [customer, guest]) {
    const product = (await c('/state')).body.state.products.find(
      (p) => p.id === 'TK-001',
    );
    assert(!('cost' in product));
    assert(!('listPrice' in product));
  }
});
test('fallback cost is half the discounted paid unit price, rounded once per unit', async (t) => {
  const { db, sales, pricing, buy } = await fixture(t);
  await pricing(100, null);
  assert.equal(
    (
      await sales('/sales/discounts', 'POST', {
        ids: ['TK-001'],
        percent: 25,
        key: 'discount-25',
      })
    ).status,
    200,
  );
  const id = await buy(2);
  assert.deepEqual(
    (
      await db.query(
        'SELECT unit_price,unit_cost FROM order_items WHERE order_id=$1',
        [id],
      )
    ).rows[0],
    { unit_price: 75, unit_cost: 37.5 },
  );
  await pricing(0.01, null);
  await sales('/sales/discounts', 'POST', {
    ids: ['TK-001'],
    percent: 0,
    key: 'clear',
  });
  const tiny = await buy();
  assert.equal(
    (
      await db.query('SELECT unit_cost FROM order_items WHERE order_id=$1', [
        tiny,
      ])
    ).rows[0].unit_cost,
    0.01,
  );
});
test('pricing validates precision, missing values, negative costs and archived products', async (t) => {
  const { sales, db } = await fixture(t);
  for (const body of [
    { price: -1, cost: 0 },
    { price: 1.001, cost: 0 },
    { price: 1, cost: -1 },
    { price: 1, cost: 0.001 },
    { price: null, cost: 0 },
    { price: 1 },
  ])
    assert.equal(
      (await sales('/sales/products/TK-001/pricing', 'PATCH', body)).status,
      400,
    );
  assert.equal(
    (
      await sales('/sales/products/missing/pricing', 'PATCH', {
        price: 1,
        cost: 0,
      })
    ).status,
    404,
  );
  await db.query("UPDATE products SET archived=true WHERE code='TK-001'");
  assert.equal(
    (
      await sales('/sales/products/TK-001/pricing', 'PATCH', {
        price: 1,
        cost: 0,
      })
    ).status,
    404,
  );
});
test('discount notifications go only to saved-product owners and operation retries are idempotent', async (t) => {
  const { sales, customer, guest, client, pricing } = await fixture(t);
  const other = client();
  await other('/auth/register', 'POST', {
    email: 'other@example.com',
    password: 'Password!24',
    name: 'Other',
  });
  await customer('/wishlist/items/TK-001', 'PUT');
  await pricing(100);
  const operation = { ids: ['TK-001'], percent: 20, key: 'campaign-a' };
  assert.equal(
    (await sales('/sales/discounts', 'POST', operation)).status,
    200,
  );
  assert.equal(
    (await sales('/sales/discounts', 'POST', operation)).status,
    200,
  );
  assert.equal(
    (
      await sales('/sales/discounts', 'POST', {
        ...operation,
        key: 'campaign-b',
      })
    ).status,
    200,
  );
  const state = (await customer('/state')).body.state;
  assert.equal(state.notifications.length, 1);
  assert.match(state.notifications[0].message, /80.00 TRY/);
  assert.equal((await other('/state')).body.state.notifications.length, 0);
  assert.equal((await guest('/state')).body.state.notifications.length, 0);
  const p = state.products.find((p) => p.id === 'TK-001');
  assert.equal(p.price, 80);
  assert.equal(p.originalPrice, 100);
  assert.equal(
    (
      await other(
        `/notifications/${state.notifications[0].id}/read`,
        'PATCH',
        {},
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await customer(
        `/notifications/${state.notifications[0].id}/read`,
        'PATCH',
        {},
      )
    ).status,
    200,
  );
  assert((await customer('/state')).body.state.notifications[0].readAt);
  assert.equal(
    (await sales('/sales/discounts', 'POST', { ...operation, percent: 30 }))
      .status,
    409,
  );
  await sales('/sales/discounts', 'POST', {
    ...operation,
    key: 'remove',
    percent: 0,
  });
  assert.equal(
    (await guest('/state')).body.state.products.find((p) => p.id === 'TK-001')
      .price,
    100,
  );
});
test('wishlist ownership persists across sessions and cannot be written by guests or staff', async (t) => {
  const { sales, customer, guest, client } = await fixture(t);
  await customer('/wishlist/items/TK-002', 'PUT');
  await customer('/wishlist/items/TK-002', 'PUT');
  const otherSession = client();
  await otherSession('/auth/login', 'POST', {
    email: 'deniz@example.com',
    password: 'CustomerDemo!24',
  });
  assert.deepEqual((await otherSession('/state')).body.state.wishlist, [
    'TK-002',
  ]);
  assert.equal((await guest('/wishlist/items/TK-002', 'PUT')).status, 401);
  assert.equal((await sales('/wishlist/items/TK-002', 'PUT')).status, 403);
  await otherSession('/wishlist/items/TK-002', 'DELETE');
  assert.deepEqual((await customer('/state')).body.state.wishlist, []);
});
test('invalid bulk discounts roll back all selected product updates and notifications', async (t) => {
  const { db, sales, pricing } = await fixture(t);
  await pricing(100);
  for (const body of [
    { ids: [], percent: 10, key: 'a' },
    { ids: ['TK-001'], percent: 10.5, key: 'b' },
    { ids: ['TK-001'], percent: 101, key: 'c' },
    { ids: ['TK-001', 'TK-001'], percent: 10, key: 'd' },
  ])
    assert.equal((await sales('/sales/discounts', 'POST', body)).status, 400);
  const r = await sales('/sales/discounts', 'POST', {
    ids: ['TK-001', 'missing'],
    percent: 20,
    key: 'rollback',
  });
  assert.equal(r.status, 409);
  assert.equal(
    (await db.query("SELECT price FROM products WHERE code='TK-001'")).rows[0]
      .price,
    100,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM discount_operations'))
      .rows[0].n,
    0,
  );
});
test('free products and explicit zero costs remain zero at 100 percent discount', async (t) => {
  const { db, sales, pricing, buy } = await fixture(t);
  await pricing(10, 0);
  await sales('/sales/discounts', 'POST', {
    ids: ['TK-001'],
    percent: 100,
    key: 'free',
  });
  const id = await buy();
  assert.deepEqual(
    (
      await db.query(
        'SELECT unit_price,unit_cost FROM order_items WHERE order_id=$1',
        [id],
      )
    ).rows[0],
    { unit_price: 0, unit_cost: 0 },
  );
});
test('approval requires confirmed store receipt; partial refunds use paid snapshots after price changes', async (t) => {
  const { db, sales, customer, pricing, buy, returnFor } = await fixture(t);
  await pricing(100, 30);
  const id = await buy(3);
  const request = await returnFor(id, 2);
  await pricing(999, 800);
  assert.equal(
    (await sales(`/sales/returns/${request}/approve`, 'POST', {})).status,
    409,
  );
  assert.equal(
    (
      await sales(`/sales/returns/${request}/receive`, 'POST', {
        confirmed: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await sales(`/sales/returns/${request}/receive`, 'POST', {
        confirmed: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await sales(`/sales/returns/${request}/approve`, 'POST', {})).status,
    200,
  );
  const f = (
    await db.query(
      'SELECT amount,returned_cost FROM refunds WHERE return_id=$1',
      [request],
    )
  ).rows[0];
  assert.deepEqual(f, { amount: 200, returned_cost: 60 });
  assert.equal(
    (
      await db.query(
        "SELECT stock_quantity AS stock FROM products WHERE code='TK-001'",
      )
    ).rows[0].stock,
    11,
  );
  assert.equal(
    (await customer('/state')).body.state.orders.find((o) => o.id === id)
      .returnRequest.status,
    'Approved',
  );
  assert.match(
    (await customer('/state')).body.state.notifications[0].message,
    /200.00 TRY/,
  );
});
test('concurrent and repeated approvals create one refund, stock increase and customer notification', async (t) => {
  const { db, sales, customer, client, buy, returnFor } = await fixture(t);
  const id = await buy(2);
  const request = await returnFor(id, 1);
  await sales(`/sales/returns/${request}/receive`, 'POST', { confirmed: true });
  const second = client();
  await second('/auth/login', 'POST', {
    email: 'sales@takistir.local',
    password: 'SalesDemo!24',
  });
  const results = await Promise.all([
    sales(`/sales/returns/${request}/approve`, 'POST', {}),
    second(`/sales/returns/${request}/approve`, 'POST', {}),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  await sales(`/sales/returns/${request}/approve`, 'POST', {});
  await sales(`/sales/returns/${request}/receive`, 'POST', { confirmed: true });
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM refunds')).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT stock_quantity AS stock FROM products WHERE code='TK-001'",
      )
    ).rows[0].stock,
    11,
  );
  assert.equal((await customer('/state')).body.state.notifications.length, 1);
  assert.equal(
    (
      await sales(`/sales/returns/${request}/reject`, 'POST', {
        reason: 'Too late',
      })
    ).status,
    409,
  );
});
test('rejection records a reason without refunding/restocking; resubmitting it sends no duplicate notice', async (t) => {
  const { db, sales, customer, buy, returnFor } = await fixture(t);
  const id = await buy();
  const request = await returnFor(id);
  assert.equal(
    (await sales(`/sales/returns/${request}/reject`, 'POST', { reason: ' ' }))
      .status,
    400,
  );
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await sales(`/sales/returns/${request}/reject`, 'POST', {
          reason: 'Damaged item',
        })
      ).status,
      200,
    );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM refunds')).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT stock_quantity AS stock FROM products WHERE code='TK-001'",
      )
    ).rows[0].stock,
    11,
  );
  const state = (await customer('/state')).body.state;
  assert.equal(state.notifications.length, 1);
  assert.equal(
    state.orders.find((o) => o.id === id).returnRequest.reason,
    'Damaged item',
  );
  assert.equal(
    (await sales(`/sales/returns/${request}/approve`, 'POST', {})).status,
    409,
  );
});
test('reports book sales on sale date and refunds plus cost reversals on approval date', async (t) => {
  const { db, sales, pricing, buy, returnFor } = await fixture(t);
  await pricing(100, 30);
  const id = await buy(3);
  const request = await returnFor(id, 2);
  await db.query("UPDATE orders SET order_date='2026-01-01' WHERE id=$1", [id]);
  await sales(`/sales/returns/${request}/receive`, 'POST', { confirmed: true });
  await sales(`/sales/returns/${request}/approve`, 'POST', {});
  await db.query(
    "UPDATE refunds SET approved_at='2026-02-01T23:59:59Z' WHERE return_id=$1",
    [request],
  );
  await pricing(500, 400);
  const january = (await sales(range('2026-01-01'))).body;
  assert.deepEqual(january.totals, {
    gross: 300,
    cost: 90,
    refunds: 0,
    returnedCost: 0,
    net: 300,
    netCost: 90,
    profit: 210,
  });
  const feb = (await sales(range('2026-02-01'))).body;
  assert.equal(feb.invoices.length, 0);
  assert.deepEqual(feb.totals, {
    gross: 0,
    cost: 0,
    refunds: 200,
    returnedCost: 60,
    net: -200,
    netCost: -60,
    profit: -140,
  });
  const combined = (
    await sales('/sales/workspace?from=2026-01-01&to=2026-02-01')
  ).body;
  assert.equal(combined.totals.net, 100);
  assert.equal(combined.totals.profit, 70);
  assert.equal(
    combined.series.reduce((s, d) => s + d.profit, 0),
    combined.totals.profit,
  );
});
test('pending returns do not reduce revenue; cancelled orders remain labelled in invoices only', async (t) => {
  const { sales, customer, pricing, buy, returnFor } = await fixture(t);
  await pricing(100, 0);
  const id = await buy();
  await returnFor(id);
  const cancelled = await buy();
  await customer(`/orders/${cancelled}/cancel`, 'POST', {});
  const report = (await sales(range())).body;
  assert.equal(report.invoices.length, 2);
  assert(report.invoices.some((i) => i.status === 'Cancelled'));
  assert.equal(report.totals.gross, 100);
  assert.equal(report.totals.refunds, 0);
  assert.equal(report.totals.profit, 100);
});
test('report dates are validated and empty inclusive ranges have zero totals', async (t) => {
  const { sales } = await fixture(t);
  for (const q of [
    'from=2026-02-30&to=2026-03-01',
    'from=2026-02-02&to=2026-01-01',
    'from=no&to=no',
    'from=2026-01-01',
    'from=2026-01-01&from=2026-01-02&to=2026-02-01',
  ])
    assert.equal((await sales(`/sales/workspace?${q}`)).status, 400);
  const empty = (await sales(range('2000-01-01'))).body;
  assert.equal(empty.invoices.length, 0);
  assert.equal(empty.series.length, 0);
  assert.equal(empty.totals.profit, 0);
});
test('sales demo account backfill preserves all existing users, products and passwords', async (t) => {
  const { db } = await fixture(t);
  const original = (
    await db.query("SELECT password_hash FROM users WHERE id='CU-001'")
  ).rows[0].password_hash;
  await db.query("DELETE FROM users WHERE id='SM-001'");
  await db.query("UPDATE products SET stock_quantity=7 WHERE code='TK-001'");
  await seedDemoData(db);
  await seedDemoData(db);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM users WHERE role='sales-manager'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("SELECT password_hash FROM users WHERE id='CU-001'"))
      .rows[0].password_hash,
    original,
  );
  assert.equal(
    (await db.query("SELECT stock_quantity FROM products WHERE code='TK-001'"))
      .rows[0].stock_quantity,
    7,
  );
});
