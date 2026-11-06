import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, stopServer } from './postgres.js';

after(stopServer);

// SCRUM-48: exercise direct SQL writes so API checks cannot hide schema gaps.
async function fixture(t) {
  const { db } = await freshDb(t);
  const { rows } = await db.query(
    "SELECT id FROM products WHERE code = 'TK-001'",
  );
  return { db, productId: rows[0].id };
}

test('cart owners and cart/product lines stay unique on direct SQL inserts', async (t) => {
  const { db, productId } = await fixture(t);
  const { rows } = await db.query(
    "INSERT INTO carts (customer_id) VALUES ('CU-001') RETURNING id",
  );
  const id = rows[0].id;
  await assert.rejects(
    db.query("INSERT INTO carts (customer_id) VALUES ('CU-001')"),
    { code: '23505' },
  );
  await db.query('INSERT INTO carts (guest_token_hash) VALUES ($1)', [
    'a'.repeat(64),
  ]);
  await assert.rejects(
    db.query('INSERT INTO carts (guest_token_hash) VALUES ($1)', [
      'a'.repeat(64),
    ]),
    { code: '23505' },
  );
  await db.query(
    'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 1)',
    [id, productId],
  );
  await assert.rejects(
    db.query(
      'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 2)',
      [id, productId],
    ),
    { code: '23505' },
  );
  assert.equal(
    (await db.query('SELECT quantity FROM cart_items WHERE cart_id = $1', [id]))
      .rows[0].quantity,
    1,
  );
});

test('cart foreign keys reject missing customers, carts and products', async (t) => {
  const { db, productId } = await fixture(t);
  await assert.rejects(
    db.query("INSERT INTO carts (customer_id) VALUES ('missing-customer')"),
    { code: '23503' },
  );
  const { rows } = await db.query(
    "INSERT INTO carts (customer_id) VALUES ('CU-001') RETURNING id",
  );
  for (const [cart, product] of [
    [-1, productId],
    [rows[0].id, -1],
  ])
    await assert.rejects(
      db.query(
        'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 1)',
        [cart, product],
      ),
      { code: '23503' },
    );
});

test('invalid quantities cannot overwrite a valid cart line', async (t) => {
  const { db, productId } = await fixture(t);
  const { rows } = await db.query(
    "INSERT INTO carts (customer_id) VALUES ('CU-001') RETURNING id",
  );
  const id = rows[0].id;
  await db.query(
    'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 3)',
    [id, productId],
  );
  for (const quantity of [0, -1])
    await assert.rejects(
      db.query('UPDATE cart_items SET quantity = $1 WHERE cart_id = $2', [
        quantity,
        id,
      ]),
      { code: '23514' },
    );
  await assert.rejects(
    db.query('UPDATE cart_items SET quantity = NULL WHERE cart_id = $1', [id]),
    { code: '23502' },
  );
  assert.equal(
    (await db.query('SELECT quantity FROM cart_items WHERE cart_id = $1', [id]))
      .rows[0].quantity,
    3,
  );
});

test('deleting a cart removes only its own lines and never its products', async (t) => {
  const { db, productId } = await fixture(t);
  const ids = [];
  for (const hash of ['a', 'b']) {
    const { rows } = await db.query(
      'INSERT INTO carts (guest_token_hash) VALUES ($1) RETURNING id',
      [hash.repeat(64)],
    );
    ids.push(rows[0].id);
    await db.query(
      'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 2)',
      [rows[0].id, productId],
    );
  }
  await db.query('DELETE FROM carts WHERE id = $1', [ids[0]]);
  assert.deepEqual((await db.query('SELECT cart_id FROM cart_items')).rows, [
    { cart_id: ids[1] },
  ]);
  assert.equal(
    (
      await db.query('SELECT stock_quantity FROM products WHERE id = $1', [
        productId,
      ])
    ).rows[0].stock_quantity,
    12,
  );
});

test('deleting an otherwise unreferenced customer cascades through their cart', async (t) => {
  const { db, productId } = await fixture(t);
  await db.query(
    `INSERT INTO users (id, name, email, role, password_hash)
     SELECT 'CART-ONLY', 'Cart test', 'cart-only@example.com', 'customer', password_hash
     FROM users WHERE id = 'CU-001'`,
  );
  const { rows } = await db.query(
    "INSERT INTO carts (customer_id) VALUES ('CART-ONLY') RETURNING id",
  );
  const id = rows[0].id;
  await db.query(
    'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 1)',
    [id, productId],
  );
  await db.query("DELETE FROM users WHERE id = 'CART-ONLY'");
  assert.deepEqual(
    (await db.query('SELECT id FROM carts WHERE id = $1', [id])).rows,
    [],
  );
  assert.deepEqual(
    (await db.query('SELECT cart_id FROM cart_items WHERE cart_id = $1', [id]))
      .rows,
    [],
  );
});

test('a failed ownership transfer rolls back cart ownership and item changes', async (t) => {
  const { db, productId } = await fixture(t);
  const hash = 'c'.repeat(64);
  const { rows } = await db.query(
    'INSERT INTO carts (guest_token_hash) VALUES ($1) RETURNING id',
    [hash],
  );
  const id = rows[0].id;
  await db.query(
    'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, 2)',
    [id, productId],
  );
  await assert.rejects(
    db.tx(async (c) => {
      await c.query(
        "UPDATE carts SET customer_id = 'CU-001', guest_token_hash = NULL WHERE id = $1",
        [id],
      );
      await c.query('UPDATE cart_items SET quantity = 0 WHERE cart_id = $1', [
        id,
      ]);
    }),
    { code: '23514' },
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT customer_id, guest_token_hash FROM carts WHERE id = $1',
        [id],
      )
    ).rows,
    [{ customer_id: null, guest_token_hash: hash }],
  );
  assert.equal(
    (await db.query('SELECT quantity FROM cart_items WHERE cart_id = $1', [id]))
      .rows[0].quantity,
    2,
  );
});
