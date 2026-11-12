import { randomUUID } from 'node:crypto';
import { returnEligible } from '../../shared/order-rules.js';
import { canTransition, validateProduct } from '../../shared/catalog-rules.js';

// Business rules and messages are unchanged from the SQLite version; only data
// access moved to PostgreSQL. Every mutating function receives `c`, a client
// that is already inside a transaction (see db.tx), so a thrown error rolls
// back everything the function changed.

export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
export function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    fail(400, `${label} is required (maximum ${max} characters).`);
  return value.trim();
}
export function customer(user) {
  if (user?.role !== 'customer')
    fail(user ? 403 : 401, 'A customer account is required.');
}
export function manager(user) {
  if (user?.role !== 'product-manager')
    fail(user ? 403 : 401, 'Product Manager access is required.');
}

// ---------- Row → API object mapping ----------

const USER_COLUMNS = `id, name, email, home_address, tax_id, role`;
export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    home: row.home_address,
    taxId: row.tax_id,
    role: row.role,
  };
}
export async function findUser(c, where, value) {
  const column = where === 'email' ? 'email' : 'id';
  const { rows } = await c.query(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE ${column} = $1`,
    [value],
  );
  return rows[0] ?? null;
}

function productFromRow(r) {
  return {
    id: r.code,
    name: r.name,
    category: r.category,
    price: r.price,
    stock: r.stock_quantity,
    rating: r.seed_rating,
    ratingCount: r.seed_rating_count,
    popularity: r.popularity,
    collection: r.collection,
    model: r.model,
    serial: r.serial_number,
    material: r.material,
    description: r.description,
    warranty: r.warranty_status,
    distributor: r.distributor,
    image: r.image,
    ...(r.detail_image ? { detailImage: r.detail_image } : {}),
    archived: r.archived,
  };
}

/** Orders with their items and return requests, in the API's shape. */
async function loadOrders(c, whereSql, params) {
  const { rows: orders } = await c.query(
    `SELECT o.*, r.id AS return_id, r.status AS return_status, r.amount AS return_amount
     FROM orders o LEFT JOIN return_requests r ON r.order_id = o.id
     WHERE ${whereSql} ORDER BY o.seq DESC`,
    params,
  );
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const { rows: items } = await c.query(
    `SELECT i.order_id, p.code, i.product_name, i.product_image, i.quantity, i.unit_price
     FROM order_items i JOIN products p ON p.id = i.product_id
     WHERE i.order_id = ANY($1) ORDER BY i.order_id, i.position`,
    [ids],
  );
  const { rows: returned } = await c.query(
    `SELECT r.order_id, p.code, ri.quantity
     FROM return_request_items ri
     JOIN return_requests r ON r.id = ri.return_id
     JOIN products p ON p.id = ri.product_id
     WHERE r.order_id = ANY($1)`,
    [ids],
  );
  return orders.map((o) => {
    const orderItems = items
      .filter((i) => i.order_id === o.id)
      .map((i) => ({
        id: i.code,
        name: i.product_name,
        image: i.product_image,
        qty: i.quantity,
        price: i.unit_price,
      }));
    return {
      id: o.id,
      customerId: o.customer_id,
      deliveryId: o.delivery_id,
      date: o.order_date,
      status: o.status,
      items: orderItems,
      address: o.delivery_address,
      ...(o.tracking_number ? { tracking: o.tracking_number } : {}),
      ...(o.return_id
        ? {
            returnRequest: {
              id: o.return_id,
              status: o.return_status,
              items: returned
                .filter((r) => r.order_id === o.id)
                .map((r) => ({
                  ...orderItems.find((i) => i.id === r.code),
                  qty: r.quantity,
                })),
              amount: o.return_amount,
            },
          }
        : {}),
    };
  });
}

/**
 * The state snapshot returned by GET /api/state and every mutation.
 * Same shape and the same role/ownership filtering as before.
 */
export async function view(c, user) {
  const isManager = user?.role === 'product-manager';
  // Before the first nextval() a sequence reports last_value = 1 with
  // is_called = false; treat that as revision 0.
  const revision = Number(
    (
      await c.query(
        'SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS v FROM state_revision',
      )
    ).rows[0].v,
  );
  const { rows: categoryRows } = await c.query(
    'SELECT name FROM categories WHERE NOT archived ORDER BY id',
  );
  const orders = user
    ? await loadOrders(
        c,
        isManager ? 'TRUE' : 'o.customer_id = $1',
        isManager ? [] : [user.id],
      )
    : [];
  const historicalIds = orders.flatMap((o) => o.items.map((i) => i.id));
  const { rows: productRows } = await c.query(
    `SELECT p.*, c.name AS category,
       COALESCE(r.rating_count, 0)::int AS live_rating_count,
       COALESCE(r.rating_sum, 0)::int AS live_rating_sum
     FROM products p JOIN categories c ON c.id = p.category_id
     LEFT JOIN (SELECT product_id, count(*) AS rating_count, sum(rating) AS rating_sum
                FROM reviews GROUP BY product_id) r ON r.product_id = p.id
     WHERE NOT p.archived OR $1 OR p.code = ANY($2)
     ORDER BY p.id`,
    [isManager, historicalIds],
  );
  const { rows: reviewRows } = await c.query(
    `SELECT r.*, p.code FROM reviews r JOIN products p ON p.id = r.product_id
     WHERE $1 OR r.status = 'Approved' OR r.customer_id = $2
     ORDER BY r.seq`,
    [isManager, user?.id ?? null],
  );
  return {
    revision,
    user: publicUser(user),
    categories: categoryRows.map((r) => r.name),
    products: productRows.map((row) => {
      const product = productFromRow(row);
      const count = (product.ratingCount || 0) + row.live_rating_count;
      const sum =
        (product.rating || 0) * (product.ratingCount || 0) +
        row.live_rating_sum;
      return {
        ...product,
        publishedRating: {
          count,
          rating: count ? (sum / count).toFixed(1) : 'No ratings yet',
        },
      };
    }),
    orders,
    reviews: reviewRows.map((r) =>
      isManager || (user && r.customer_id === user.id)
        ? {
            id: r.id,
            productId: r.code,
            rating: r.rating,
            comment: r.comment,
            customerId: r.customer_id,
            author: r.author_name,
            status: r.status,
          }
        : {
            id: r.id,
            productId: r.code,
            author: `${r.author_name.slice(0, 1)}***`,
            rating: r.rating,
            comment: r.comment,
            status: r.status,
          },
    ),
  };
}

// ---------- Product Manager ----------

export async function saveProduct(c, body, editingId) {
  const fields = [
    'id',
    'name',
    'category',
    'model',
    'serial',
    'description',
    'warranty',
    'distributor',
    'material',
    'stock',
    'image',
  ];
  const draft = Object.fromEntries(
    fields.map((key) => [
      key,
      typeof body[key] === 'string' ? body[key].trim() : body[key],
    ]),
  );
  if ('price' in body || 'discount' in body || 'role' in body)
    fail(403, 'Pricing and discounts are outside Product Manager permissions.');
  // Shared validation (also used by the manager UI) needs the existing IDs,
  // serials and categories. Archived products are included on purpose:
  // their IDs and serials cannot be reused.
  const { rows: existing } = await c.query(
    'SELECT code AS id, serial_number AS serial FROM products',
  );
  const { rows: categories } = await c.query(
    'SELECT id, name FROM categories WHERE NOT archived',
  );
  const error = validateProduct(
    draft,
    existing,
    categories.map((r) => r.name),
    editingId,
  );
  if (error) fail(400, error);
  const categoryId = categories.find((r) => r.name === draft.category).id;
  if (editingId) {
    const { rows } = await c.query(
      `UPDATE products SET name=$2, category_id=$3, model=$4, serial_number=$5,
         description=$6, warranty_status=$7, distributor=$8, material=$9,
         stock_quantity=$10,
         detail_image = CASE WHEN image = $11 THEN detail_image ELSE NULL END,
         image=$11
       WHERE code = $1 AND NOT archived RETURNING id`,
      [
        editingId,
        draft.name,
        categoryId,
        draft.model,
        draft.serial,
        draft.description,
        draft.warranty,
        draft.distributor,
        draft.material,
        draft.stock,
        draft.image,
      ],
    );
    if (!rows.length) fail(404, 'Product not found.');
  } else
    await c.query(
      `INSERT INTO products (code, name, category_id, model, serial_number,
         description, warranty_status, distributor, material, stock_quantity,
         image, price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL)`,
      [
        draft.id,
        draft.name,
        categoryId,
        draft.model,
        draft.serial,
        draft.description,
        draft.warranty,
        draft.distributor,
        draft.material,
        draft.stock,
        draft.image,
      ],
    );
}
export async function archiveProduct(c, id) {
  const { rowCount } = await c.query(
    'UPDATE products SET archived = TRUE WHERE code = $1 AND NOT archived',
    [id],
  );
  if (!rowCount) fail(404, 'Product not found.');
}
export async function setStock(c, id, stock) {
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000)
    fail(400, 'Stock must be a whole number between 0 and 1,000,000.');
  const { rowCount } = await c.query(
    'UPDATE products SET stock_quantity = $2 WHERE code = $1 AND NOT archived',
    [id, stock],
  );
  if (!rowCount) fail(404, 'Product not found.');
}
export async function addCategory(c, rawName) {
  const name = text(rawName, 'Category', 60);
  if (['new arrivals', 'all accessories'].includes(name.toLowerCase()))
    fail(409, 'This category name is already used or reserved.');
  // A previously deleted (archived) category with the same name is restored.
  const { rows } = await c.query(
    `INSERT INTO categories (name) VALUES ($1)
     ON CONFLICT ((lower(btrim(name)))) DO UPDATE
       SET archived = FALSE, name = EXCLUDED.name
       WHERE categories.archived
     RETURNING id`,
    [name],
  );
  if (!rows.length)
    fail(409, 'This category name is already used or reserved.');
}
export async function removeCategory(c, name) {
  const { rows } = await c.query(
    'SELECT id FROM categories WHERE name = $1 AND NOT archived FOR UPDATE',
    [name],
  );
  if (!rows.length) fail(404, 'Category not found.');
  const inUse = await c.query(
    'SELECT 1 FROM products WHERE category_id = $1 AND NOT archived LIMIT 1',
    [rows[0].id],
  );
  if (inUse.rowCount)
    fail(409, 'Move or remove products in this category first.');
  // Archived products still point at this category, so it is archived too.
  await c.query('UPDATE categories SET archived = TRUE WHERE id = $1', [
    rows[0].id,
  ]);
}
export async function updateStatus(c, id, status) {
  const { rows } = await c.query(
    'SELECT status FROM orders WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!rows.length) fail(404, 'Order not found.');
  if (!canTransition(rows[0].status, status))
    fail(409, 'Orders must progress Processing → In transit → Delivered.');
  await c.query('UPDATE orders SET status = $2 WHERE id = $1', [id, status]);
}
export async function moderateReview(c, id, status) {
  const { rows } = await c.query(
    'SELECT status FROM reviews WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!rows.length) fail(404, 'Review not found.');
  if (rows[0].status !== 'Pending')
    fail(409, 'This review has already been moderated.');
  if (!['Approved', 'Rejected'].includes(status))
    fail(400, 'Choose Approved or Rejected.');
  await c.query('UPDATE reviews SET status = $2 WHERE id = $1', [id, status]);
}

// ---------- Customer ----------

/** An order visible to this user (owner or Product Manager), else 404. */
export async function orderFor(c, user, id, { lock = false } = {}) {
  const { rows } = await c.query(
    `SELECT * FROM orders WHERE id = $1 AND ($2 OR customer_id = $3)
     ${lock ? 'FOR UPDATE' : ''}`,
    [id, user?.role === 'product-manager', user?.id ?? null],
  );
  if (!rows.length) fail(404, 'Order not found.');
  return rows[0];
}
export async function invoiceFor(c, user, id) {
  await orderFor(c, user, id);
  return (await loadOrders(c, 'o.id = $1', [id]))[0];
}

async function existingCheckout(c, user, key) {
  const { rows } = await c.query(
    'SELECT id FROM orders WHERE customer_id = $1 AND checkout_key = $2',
    [user.id, key],
  );
  return rows[0]?.id;
}

export async function placeOrder(c, user, body) {
  customer(user);
  const key = text(body.key, 'Checkout key', 100);
  const prior = await existingCheckout(c, user, key);
  if (prior) return prior;
  if (
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 100
  )
    fail(400, 'Your cart must contain 1–100 items.');
  const ids = new Set();
  for (const item of body.items) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id))
      fail(400, 'Duplicate or invalid cart item.');
    ids.add(item.id);
  }
  // Lock the purchased products. Rows are locked in id order so two checkouts
  // with the same products in a different order cannot deadlock. A competing
  // checkout waits here and then sees the reduced stock.
  const { rows: locked } = await c.query(
    `SELECT id, code, name, image, price, stock_quantity FROM products
     WHERE code = ANY($1) AND NOT archived ORDER BY id FOR UPDATE`,
    [[...ids]],
  );
  // The same key may have been committed by a parallel retry while we waited.
  const raced = await existingCheckout(c, user, key);
  if (raced) return raced;
  const items = body.items.map((item) => {
    const p = locked.find((p) => p.code === item.id);
    if (
      !p ||
      p.price === null ||
      !Number.isSafeInteger(item.qty) ||
      item.qty < 1 ||
      item.qty > p.stock_quantity
    )
      fail(409, 'Stock or availability changed. Please review your cart.');
    // The price always comes from the database, never from the client.
    return {
      productId: p.id,
      name: p.name,
      image: p.image,
      qty: item.qty,
      price: p.price,
    };
  });
  const address = body.address || {};
  const line = `${text(address.name, 'Recipient')} · ${text(address.street, 'Street', 300)}, ${text(address.city, 'City')} ${text(address.postcode, 'Postcode', 20)}`;
  for (const item of items)
    await c.query(
      'UPDATE products SET stock_quantity = stock_quantity - $2 WHERE id = $1',
      [item.productId, item.qty],
    );
  let id;
  // Skip numbers already used (for example by imported orders).
  while (!id) {
    const n = (await c.query("SELECT nextval('order_number_seq') AS n")).rows[0]
      .n;
    const { rows } = await c.query(
      `INSERT INTO orders (id, customer_id, delivery_id, delivery_address, checkout_key)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [`TK-${n}`, user.id, `DL-TK-${n}`, line, key],
    );
    id = rows[0]?.id;
  }
  for (const [position, item] of items.entries())
    await c.query(
      `INSERT INTO order_items (order_id, product_id, position, product_name,
         product_image, quantity, unit_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        item.productId,
        position,
        item.name,
        item.image,
        item.qty,
        item.price,
      ],
    );
  return id;
}
export async function cancelOrder(c, user, id) {
  customer(user);
  const order = await orderFor(c, user, id, { lock: true });
  if (order.status !== 'Processing')
    fail(409, 'Only Processing orders can be cancelled.');
  await c.query("UPDATE orders SET status = 'Cancelled' WHERE id = $1", [id]);
  if (order.inventory_reserved)
    await c.query(
      `UPDATE products p SET stock_quantity = p.stock_quantity + i.quantity
       FROM order_items i WHERE i.order_id = $1 AND p.id = i.product_id`,
      [id],
    );
}
export async function submitReview(c, user, body) {
  customer(user);
  const delivered = await c.query(
    `SELECT 1 FROM orders o
     JOIN order_items i ON i.order_id = o.id
     JOIN products p ON p.id = i.product_id
     WHERE o.customer_id = $1 AND o.status = 'Delivered' AND p.code = $2
     LIMIT 1`,
    [user.id, typeof body.productId === 'string' ? body.productId : ''],
  );
  if (!delivered.rowCount)
    fail(403, 'Only delivered purchases can be reviewed.');
  const { rows } = await c.query(
    'SELECT id FROM products WHERE code = $1 AND NOT archived',
    [body.productId],
  );
  if (!rows.length) fail(404, 'Product not found.');
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)
    fail(400, 'Rating must be between 1 and 5.');
  await c.query(
    `INSERT INTO reviews (id, product_id, customer_id, author_name, rating, comment)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      randomUUID(),
      rows[0].id,
      user.id,
      user.name,
      body.rating,
      text(body.comment, 'Comment', 500),
    ],
  );
}
export async function requestReturn(c, user, id, selected) {
  customer(user);
  const order = await orderFor(c, user, id, { lock: true });
  const hasRequest = await c.query(
    'SELECT 1 FROM return_requests WHERE order_id = $1',
    [id],
  );
  if (
    !returnEligible({ status: order.status, date: order.order_date }) ||
    hasRequest.rowCount
  )
    fail(409, 'This order is not eligible for a new return request.');
  if (
    !selected ||
    typeof selected !== 'object' ||
    Array.isArray(selected) ||
    !Object.keys(selected).length
  )
    fail(400, 'Select items to return.');
  const { rows: orderItems } = await c.query(
    `SELECT p.code, i.product_id, i.quantity, i.unit_price
     FROM order_items i JOIN products p ON p.id = i.product_id
     WHERE i.order_id = $1`,
    [id],
  );
  const items = Object.entries(selected).map(([code, qty]) => {
    const item = orderItems.find((i) => i.code === code);
    if (!item || !Number.isInteger(qty) || qty < 1 || qty > item.quantity)
      fail(400, 'Invalid return quantity.');
    return { productId: item.product_id, qty, price: item.unit_price };
  });
  // Refund at the price actually paid (requirement 16), in exact cents.
  const cents = items.reduce(
    (sum, i) => sum + Math.round(i.price * 100) * i.qty,
    0,
  );
  const returnId = `R-${randomUUID()}`;
  await c.query(
    'INSERT INTO return_requests (id, order_id, amount) VALUES ($1, $2, $3)',
    [returnId, id, cents / 100],
  );
  for (const item of items)
    await c.query(
      'INSERT INTO return_request_items (return_id, product_id, quantity) VALUES ($1,$2,$3)',
      [returnId, item.productId, item.qty],
    );
}
export async function updateProfile(c, user, body) {
  const name = text(body?.name, 'Name');
  const email = text(body?.email, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail(400, 'Enter a valid email address.');
  const taken = await c.query(
    'SELECT 1 FROM users WHERE email = $1 AND id <> $2',
    [email, user.id],
  );
  if (taken.rowCount) fail(409, 'This email is already registered.');
  if (typeof body.home !== 'string' || body.home.length > 500)
    fail(400, 'Home address must contain at most 500 characters.');
  const { rows } = await c.query(
    `UPDATE users SET name = $2, email = $3, home_address = $4 WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [user.id, name, email, body.home.trim()],
  );
  return publicUser(rows[0]);
}
