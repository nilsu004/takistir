import { fail } from './service.js';

// SCRUM-49: carts for guests and signed-in customers.
// Prices, availability and totals always come from the database; the client
// only sends a product code and a quantity. A cart does not reserve stock:
// checkout checks and decreases stock again in its own transaction.

export const GUEST_CART_DAYS = 30;
export const MAX_CART_LINES = 100;

/**
 * Who owns the cart for this request.
 * Signed-in customers use their account cart; guests use the cart cookie.
 * Staff accounts have no cart.
 */
export function cartOwner(user, guestTokenHash) {
  if (user && user.role !== 'customer')
    fail(403, 'Only customers and guests have a shopping cart.');
  return user
    ? { column: 'customer_id', value: user.id }
    : { column: 'guest_token_hash', value: guestTokenHash };
}

const freshGuestCart = `(guest_token_hash IS NULL OR updated_at > now() - make_interval(days => ${GUEST_CART_DAYS}))`;

async function findCartId(c, owner, { lock = false } = {}) {
  if (!owner.value) return null;
  const { rows } = await c.query(
    `SELECT id FROM carts WHERE ${owner.column} = $1 AND ${freshGuestCart}
     ${lock ? 'FOR UPDATE' : ''}`,
    [owner.value],
  );
  return rows[0]?.id ?? null;
}

/** Returns the owner's cart id, creating the cart if needed (inside a transaction). */
async function ensureCart(c, owner) {
  // An expired guest cart with the same token is removed first.
  if (owner.column === 'guest_token_hash')
    await c.query(
      `DELETE FROM carts WHERE guest_token_hash = $1 AND NOT ${freshGuestCart}`,
      [owner.value],
    );
  // ON CONFLICT handles two first requests arriving at the same time.
  await c.query(
    `INSERT INTO carts (${owner.column}) VALUES ($1)
     ON CONFLICT (${owner.column}) DO NOTHING`,
    [owner.value],
  );
  const id = await findCartId(c, owner, { lock: true });
  await c.query('UPDATE carts SET updated_at = now() WHERE id = $1', [id]);
  return id;
}

/** The cart in the agreed API shape: { items, total }. */
export async function readCart(c, owner) {
  const id = await findCartId(c, owner);
  if (!id) return { items: [], total: 0 };
  const { rows } = await c.query(
    `SELECT p.code, p.name, p.image, p.price, p.stock_quantity, p.archived,
            i.quantity
     FROM cart_items i JOIN products p ON p.id = i.product_id
     WHERE i.cart_id = $1
     ORDER BY i.added_at, p.id`,
    [id],
  );
  const items = rows.map((r) => ({
    id: r.code,
    name: r.name,
    image: r.image,
    price: r.price,
    qty: r.quantity,
    stock: r.archived ? 0 : r.stock_quantity,
    // Something may have changed since the item was added (sold out,
    // removed from the catalogue or not priced yet).
    available:
      !r.archived && r.price !== null && r.quantity <= r.stock_quantity,
  }));
  // Only purchasable lines count; computed in cents to avoid float drift.
  const cents = items
    .filter((i) => i.available)
    .reduce((sum, i) => sum + Math.round(i.price * 100) * i.qty, 0);
  return { items, total: cents / 100 };
}

/** Adds a product or sets its quantity (PUT /api/cart/items/:id). */
export async function setCartItem(c, owner, code, qty) {
  if (!Number.isSafeInteger(qty) || qty < 1)
    fail(400, 'Quantity must be a whole number of at least 1.');
  const { rows } = await c.query(
    `SELECT id, price, stock_quantity FROM products
     WHERE code = $1 AND NOT archived`,
    [code],
  );
  const product = rows[0];
  if (!product) fail(404, 'Product not found.');
  if (product.price === null) fail(409, 'This product is not on sale yet.');
  if (product.stock_quantity === 0) fail(409, 'This product is out of stock.');
  if (qty > product.stock_quantity)
    fail(409, `Only ${product.stock_quantity} left in stock.`);
  const cartId = await ensureCart(c, owner);
  const { rows: lines } = await c.query(
    'SELECT product_id FROM cart_items WHERE cart_id = $1',
    [cartId],
  );
  if (
    lines.length >= MAX_CART_LINES &&
    !lines.some((l) => l.product_id === product.id)
  )
    fail(
      409,
      `A cart can contain at most ${MAX_CART_LINES} different products.`,
    );
  await c.query(
    `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [cartId, product.id, qty],
  );
}

/** Removes one product. Removing a product that is not in the cart is fine. */
export async function removeCartItem(c, owner, code) {
  const id = await findCartId(c, owner, { lock: true });
  if (!id) return;
  await c.query(
    `DELETE FROM cart_items i USING products p
     WHERE i.cart_id = $1 AND p.id = i.product_id AND p.code = $2`,
    [id, code],
  );
  await c.query('UPDATE carts SET updated_at = now() WHERE id = $1', [id]);
}

export async function clearCart(c, owner) {
  const id = await findCartId(c, owner, { lock: true });
  if (!id) return;
  await c.query('DELETE FROM cart_items WHERE cart_id = $1', [id]);
  await c.query('UPDATE carts SET updated_at = now() WHERE id = $1', [id]);
}

/** Deletes guest carts that have not changed for 30 days. */
export async function deleteExpiredGuestCarts(db) {
  await db.query(
    `DELETE FROM carts WHERE guest_token_hash IS NOT NULL AND NOT ${freshGuestCart}`,
  );
}
