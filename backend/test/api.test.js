import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createDb, migrate } from '../src/db.js';
import { passwordMatches } from '../src/passwords.js';
import { freshDb, stopServer } from './postgres.js';

after(stopServer);

async function fixture(t) {
  const { db } = await freshDb(t);
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  function client() {
    let cookie = '';
    return async (path, method = 'GET', body, extraHeaders = {}) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Takistir-Request': '1',
          ...(cookie ? { Cookie: cookie } : {}),
          ...extraHeaders,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: res.status, body: await res.json(), cookie: setCookie };
    };
  }
  const manager = client(),
    customer = client(),
    guest = client();
  assert.equal(
    (
      await manager('/auth/login', 'POST', {
        email: 'manager@takistir.local',
        password: 'ManagerDemo!24',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await customer('/auth/login', 'POST', {
        email: 'deniz@example.com',
        password: 'CustomerDemo!24',
      })
    ).status,
    200,
  );
  return { db, client, manager, customer, guest };
}
const product = {
  id: 'TK-TEST',
  name: 'Test watch',
  model: 'WATCH-1',
  serial: 'SN-TEST',
  description: 'A watch for testing.',
  category: 'Watches',
  stock: 2,
  warranty: '2 years',
  distributor: 'Takıştır',
  material: 'Steel',
  image: 'ring-card.svg',
};
const checkout = {
  key: 'checkout-test-1',
  items: [{ id: 'TK-001', qty: 1 }],
  address: {
    name: 'Deniz',
    street: 'Demo street 1',
    city: 'İstanbul',
    postcode: '34000',
  },
};

test('login, HttpOnly sessions, role boundaries, account isolation and logout', async (t) => {
  const { manager, customer, guest, client } = await fixture(t);
  assert.equal(
    (await guest('/manager/categories', 'POST', { name: 'Watches' })).status,
    401,
  );
  assert.equal(
    (await customer('/manager/categories', 'POST', { name: 'Watches' })).status,
    403,
  );
  const publicState = (await guest('/state')).body.state;
  assert.equal(publicState.user, null);
  assert.equal(publicState.orders.length, 0);
  assert(!JSON.stringify(publicState).includes('passwordHash'));
  assert(!publicState.reviews.some((r) => r.status === 'Pending'));
  const login = await guest('/auth/login', 'POST', {
    email: 'deniz@example.com',
    password: 'CustomerDemo!24',
  });
  assert.match(login.cookie, /HttpOnly/);
  assert.match(login.cookie, /SameSite=Strict/);
  assert(!JSON.stringify(login.body).includes('passwordHash'));
  assert.equal(
    (
      await client()('/auth/login', 'POST', {
        email: 'deniz@example.com',
        password: 'wrongpass',
      })
    ).status,
    401,
  );
  const other = client();
  assert.equal(
    (
      await other('/auth/register', 'POST', {
        email: 'other@example.com',
        name: 'Other',
        password: 'TestPass!24',
        role: 'product-manager',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await other('/auth/register', 'POST', {
        email: 'other@example.com',
        name: 'Other',
        password: 'TestPass!24',
      })
    ).status,
    200,
  );
  assert.equal((await other('/state')).body.state.orders.length, 0);
  assert.equal((await other('/orders/TK-1011/invoice')).status, 404);
  assert.equal((await other('/orders/TK-1024/cancel', 'POST', {})).status, 404);
  assert.equal((await customer('/orders/TK-1011/invoice')).status, 200);
  assert.equal((await manager('/orders/TK-1011/invoice')).status, 200);
  await guest('/auth/logout', 'POST', {});
  assert.equal((await guest('/state')).body.state.user, null);
});

test('request protection rejects missing headers and untrusted origins', async (t) => {
  const { manager } = await fixture(t);
  assert.equal(
    (
      await manager(
        '/manager/categories',
        'POST',
        { name: 'Watches' },
        { 'X-Takistir-Request': '' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await manager(
        '/manager/categories',
        'POST',
        { name: 'Watches' },
        { Origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
});

test('manager CRUD, category guards, stock validation and customer visibility', async (t) => {
  const { manager, customer } = await fixture(t);
  assert.equal(
    (await manager('/manager/categories', 'POST', { name: 'Watches' })).status,
    200,
  );
  assert.equal(
    (await manager('/manager/categories', 'POST', { name: ' watches ' }))
      .status,
    409,
  );
  assert.equal(
    (await manager('/manager/products', 'POST', product)).status,
    200,
  );
  assert(
    (await customer('/state')).body.state.products.some(
      (p) => p.id === product.id && p.price === null,
    ),
  );
  assert.equal(
    (await manager('/manager/categories/Watches', 'DELETE')).status,
    409,
  );
  assert.equal(
    (await manager('/manager/products/TK-TEST/stock', 'PATCH', { stock: -1 }))
      .status,
    400,
  );
  assert.equal(
    (await manager('/manager/products/TK-TEST/stock', 'PATCH', { stock: 1.5 }))
      .status,
    400,
  );
  assert.equal(
    (await manager('/manager/products/TK-TEST/stock', 'PATCH', { stock: 10 }))
      .status,
    200,
  );
  assert.equal(
    (await customer('/state')).body.state.products.find(
      (p) => p.id === product.id,
    ).stock,
    10,
  );
  assert.equal(
    (
      await manager('/manager/products/TK-TEST', 'PUT', {
        ...product,
        name: 'Updated watch',
        stock: 10,
      })
    ).status,
    200,
  );
  assert.equal(
    (await customer('/state')).body.state.products.find(
      (p) => p.id === product.id,
    ).name,
    'Updated watch',
  );
  assert.equal(
    (await manager('/manager/products/TK-TEST', 'DELETE')).status,
    200,
  );
  assert(
    !(await customer('/state')).body.state.products.some(
      (p) => p.id === product.id,
    ),
  );
  assert.equal(
    (await manager('/manager/categories/Watches', 'DELETE')).status,
    200,
  );
  await manager('/manager/categories', 'POST', { name: 'Watches' });
  assert.equal(
    (await manager('/manager/products', 'POST', product)).status,
    400,
  );
});

test('pricing is protected and price-pending products cannot be purchased', async (t) => {
  const { manager, customer } = await fixture(t);
  const p = (await manager('/state')).body.state.products[0];
  assert.equal(
    (await manager(`/manager/products/${p.id}`, 'PUT', { ...p, price: 1 }))
      .status,
    403,
  );
  assert.equal((await customer('/state')).body.state.products[0].price, 1250);
  await manager('/manager/categories', 'POST', { name: 'Watches' });
  await manager('/manager/products', 'POST', product);
  assert.equal(
    (
      await customer('/orders', 'POST', {
        ...checkout,
        items: [{ id: product.id, qty: 1 }],
      })
    ).status,
    409,
  );
});

test('checkout is atomic, server-priced and idempotent; cancellation restocks once', async (t) => {
  const { manager, customer } = await fixture(t);
  await manager('/manager/products/TK-001/stock', 'PATCH', { stock: 1 });
  const first = await customer('/orders', 'POST', {
    ...checkout,
    items: [{ id: 'TK-001', qty: 1, price: 1 }],
    price: 1,
  });
  assert.equal(first.status, 200);
  const id = first.body.data;
  assert.equal(
    first.body.state.orders.find((o) => o.id === id).items[0].price,
    1250,
  );
  const repeated = await customer('/orders', 'POST', checkout);
  assert.equal(repeated.body.data, id);
  assert.equal(
    (
      await customer('/orders', 'POST', {
        ...checkout,
        key: 'another-checkout',
      })
    ).status,
    409,
  );
  assert.equal((await manager('/state')).body.state.products[0].stock, 0);
  assert.equal(
    (await customer(`/orders/${id}/cancel`, 'POST', {})).status,
    200,
  );
  assert.equal(
    (await customer(`/orders/${id}/cancel`, 'POST', {})).status,
    409,
  );
  assert.equal((await manager('/state')).body.state.products[0].stock, 1);
});

test('concurrent purchases cannot oversell the final unit', async (t) => {
  const { manager, customer, client } = await fixture(t);
  const secondCustomer = client();
  await secondCustomer('/auth/login', 'POST', {
    email: 'deniz@example.com',
    password: 'CustomerDemo!24',
  });
  await manager('/manager/products/TK-001/stock', 'PATCH', { stock: 1 });
  const results = await Promise.all([
    customer('/orders', 'POST', { ...checkout, key: 'race-1' }),
    secondCustomer('/orders', 'POST', { ...checkout, key: 'race-2' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await manager('/state')).body.state.products[0].stock, 0);
});

test('delivery transitions appear in customer history and survive product removal', async (t) => {
  const { manager, customer } = await fixture(t);
  assert.equal(
    (
      await manager('/manager/orders/TK-1024/status', 'PATCH', {
        status: 'Delivered',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await manager('/manager/orders/TK-1024/status', 'PATCH', {
        status: 'In transit',
      })
    ).status,
    200,
  );
  assert.equal(
    (await customer('/state')).body.state.orders.find((o) => o.id === 'TK-1024')
      .status,
    'In transit',
  );
  assert.equal(
    (
      await manager('/manager/orders/TK-1024/status', 'PATCH', {
        status: 'Delivered',
      })
    ).status,
    200,
  );
  assert.equal(
    (await customer('/orders/TK-1024/cancel', 'POST', {})).status,
    409,
  );
  await manager('/manager/products/TK-003', 'DELETE');
  const invoice = (await customer('/orders/TK-1024/invoice')).body;
  assert.equal(invoice.items[0].name, 'Sol Gold Ring');
  assert.equal(invoice.items[0].price, 1450);
  assert.equal(invoice.customerId, 'CU-001');
  assert(invoice.deliveryId);
  assert(invoice.address);
});

test('guests can browse, search and sort the catalog including sold-out products', async (t) => {
  const { guest, manager } = await fixture(t);
  const categories = await guest('/categories');
  assert.equal(categories.status, 200);
  const detail = await guest('/products/TK-001');
  assert.equal(detail.status, 200);
  assert(categories.body.data.includes(detail.body.category));
  assert.equal(typeof detail.body.stock, 'number');
  assert.equal((await guest('/products/missing')).status, 404);
  const category = encodeURIComponent(detail.body.category);
  const filtered = (await guest(`/products?category=${category}`)).body.data;
  assert(filtered.some((p) => p.id === 'TK-001'));
  assert(filtered.every((p) => p.category === detail.body.category));

  await manager('/manager/products/TK-001/stock', 'PATCH', { stock: 0 });
  const search = encodeURIComponent(detail.body.name.toLowerCase());
  const matches = (await guest(`/products?q=${search}`)).body.data;
  assert(
    matches.some((p) => p.id === 'TK-001' && p.stock === 0 && !p.available),
  );
  for (const term of ['missing-catalog-term', '%', "' OR TRUE --"]) {
    assert.deepEqual(
      (await guest(`/products?q=${encodeURIComponent(term)}`)).body.data,
      [],
    );
  }
  for (const sort of ['price-asc', 'price-desc', 'popularity']) {
    const result = await guest(`/products?sort=${sort}`);
    assert.equal(result.status, 200);
    const values = result.body.data.map((p) =>
      sort === 'popularity' ? p.popularity : p.price,
    );
    assert.deepEqual(
      values,
      values.toSorted((a, b) => (sort === 'price-asc' ? a - b : b - a)),
    );
  }
  assert.equal((await guest('/products?sort=invalid')).status, 400);
  assert.equal((await guest('/products?q=a&q=b')).status, 400);
});

test('only delivered purchases can be reviewed and moderation controls comment publication', async (t) => {
  const { manager, customer, guest } = await fixture(t);
  const before = (await guest('/products/TK-002')).body;
  assert.equal(
    (
      await customer('/reviews', 'POST', {
        productId: 'TK-001',
        rating: 5,
        comment: 'Not delivered',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await customer('/reviews', 'POST', {
        productId: 'TK-002',
        rating: 6,
        comment: 'Invalid',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await customer('/reviews', 'POST', {
        productId: 'TK-002',
        rating: 1,
        comment: 'A pending comment',
      })
    ).status,
    200,
  );
  const review = (await manager('/state')).body.state.reviews.find(
    (r) => r.comment === 'A pending comment',
  );
  const published = (await guest('/state')).body.state.products.find(
    (p) => p.id === 'TK-002',
  );
  assert.equal(published.publishedRatingCount, before.publishedRatingCount + 1);
  assert.equal(published.publishedRatingTotal, before.publishedRatingTotal + 1);
  assert(
    !(await guest('/state')).body.state.reviews.some((r) => r.id === review.id),
  );
  assert.equal(
    (await guest('/products/TK-002')).body.publishedRatingCount,
    published.publishedRatingCount,
  );
  assert.equal(
    (
      await manager(`/manager/reviews/${review.id}`, 'PATCH', {
        status: 'Rejected',
      })
    ).status,
    200,
  );
  assert(
    !(await guest('/state')).body.state.reviews.some((r) => r.id === review.id),
  );
  assert.equal(
    (await manager('/manager/reviews/RV-DEMO', 'PATCH', { status: 'Approved' }))
      .status,
    200,
  );
  assert(
    (await guest('/state')).body.state.reviews.some(
      (r) => r.id === 'RV-DEMO' && r.status === 'Approved',
    ),
  );
  assert.equal(
    (await manager('/manager/reviews/RV-DEMO', 'PATCH', { status: 'Rejected' }))
      .status,
    409,
  );
});

test('state persists after reconnecting to the database and passwords are hashed', async (t) => {
  const { db, url } = await freshDb(t);
  await db.query(
    "UPDATE products SET stock_quantity = 7 WHERE code = 'TK-001'",
  );
  await db.query("INSERT INTO categories (name) VALUES ('Watches')");
  const { rows } = await db.query(
    "SELECT password_hash FROM users WHERE email = 'deniz@example.com'",
  );
  assert(!rows[0].password_hash.includes('CustomerDemo'));
  assert.match(rows[0].password_hash, /^[a-f0-9]+:[a-f0-9]+$/);
  assert(passwordMatches('CustomerDemo!24', rows[0].password_hash));
  const reopened = createDb(url, { max: 1 });
  try {
    assert.deepEqual(await migrate(reopened), []);
    const stock = await reopened.query(
      "SELECT stock_quantity FROM products WHERE code = 'TK-001'",
    );
    assert.equal(stock.rows[0].stock_quantity, 7);
    const watches = await reopened.query(
      "SELECT 1 FROM categories WHERE name = 'Watches'",
    );
    assert.equal(watches.rowCount, 1);
  } finally {
    await reopened.close();
  }
});

test('new delivered purchases accept valid selective returns, never duplicate or invalid quantities', async (t) => {
  const { manager, customer } = await fixture(t);
  const placed = await customer('/orders', 'POST', checkout);
  const id = placed.body.data;
  await manager(`/manager/orders/${id}/status`, 'PATCH', {
    status: 'In transit',
  });
  await manager(`/manager/orders/${id}/status`, 'PATCH', {
    status: 'Delivered',
  });
  assert.equal(
    (
      await customer(`/orders/${id}/returns`, 'POST', {
        selected: { 'TK-001': 2 },
      })
    ).status,
    400,
  );
  const returned = await customer(`/orders/${id}/returns`, 'POST', {
    selected: { 'TK-001': 1 },
  });
  assert.equal(returned.status, 200);
  assert.equal(
    returned.body.state.orders.find((o) => o.id === id).returnRequest.amount,
    1250,
  );
  assert.equal(
    (
      await customer(`/orders/${id}/returns`, 'POST', {
        selected: { 'TK-001': 1 },
      })
    ).status,
    409,
  );
});
