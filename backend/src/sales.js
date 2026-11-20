import { randomUUID } from 'node:crypto';
import { fail, text } from './service.js';

export function salesManager(user) {
  if (user?.role !== 'sales-manager')
    fail(user ? 403 : 401, 'Sales Manager access is required.');
}
function amount(value, label) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 999999999 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.00001
  )
    fail(
      400,
      `${label} must be a non-negative amount with up to two decimal places (maximum 999,999,999).`,
    );
  return value;
}
const discounted = (price, percent) =>
  price === null
    ? null
    : Math.round((Math.round(price * 100) * (100 - percent)) / 100) / 100;
export async function setPricing(c, code, body) {
  const price = amount(body.price, 'Sale price');
  const cost = body.cost === null ? null : amount(body.cost, 'Cost');
  const result = await c.query(
    'SELECT discount_percent FROM products WHERE code=$1 AND NOT archived FOR UPDATE',
    [code],
  );
  if (!result.rowCount) fail(404, 'Product not found.');
  await c.query(
    'UPDATE products SET list_price=$2, price=$3, cost=$4 WHERE code=$1',
    [code, price, discounted(price, result.rows[0].discount_percent), cost],
  );
}
export async function applyDiscount(c, user, body) {
  const key = text(body.key, 'Discount operation key', 100);
  if (!Number.isInteger(body.percent) || body.percent < 0 || body.percent > 100)
    fail(400, 'Discount must be a whole percentage from 0 to 100.');
  if (
    !Array.isArray(body.ids) ||
    !body.ids.length ||
    body.ids.length > 100 ||
    body.ids.some((id) => typeof id !== 'string') ||
    new Set(body.ids).size !== body.ids.length
  )
    fail(400, 'Select 1–100 different products.');
  const codes = [...body.ids].sort();
  // Serialize retries using the operation key; rollback leaves it retryable.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `discount:${key}`,
  ]);
  const prior = (
    await c.query('SELECT * FROM discount_operations WHERE id=$1', [key])
  ).rows[0];
  if (prior) {
    if (
      prior.actor_id !== user.id ||
      prior.percent !== body.percent ||
      JSON.stringify(prior.product_codes) !== JSON.stringify(codes)
    )
      fail(409, 'This discount key belongs to a different operation.');
    return;
  }
  const { rows } = await c.query(
    'SELECT * FROM products WHERE code=ANY($1) AND NOT archived ORDER BY id FOR UPDATE',
    [codes],
  );
  if (rows.length !== codes.length || rows.some((p) => p.list_price === null))
    fail(409, 'Every selected product must exist and have a sale price.');
  await c.query(
    'INSERT INTO discount_operations(id, product_codes, percent, actor_id) VALUES ($1,$2,$3,$4)',
    [key, codes, body.percent, user.id],
  );
  for (const p of rows) {
    const price = discounted(p.list_price, body.percent);
    await c.query(
      'UPDATE products SET discount_percent=$2, price=$3 WHERE id=$1',
      [p.id, body.percent, price],
    );
    if (body.percent > 0 && price < p.price) {
      const saved = await c.query(
        'SELECT customer_id FROM wishlist_items WHERE product_id=$1',
        [p.id],
      );
      for (const row of saved.rows)
        await notify(
          c,
          row.customer_id,
          `discount:${key}:${p.code}`,
          `${p.name} is now ${price.toFixed(2)} TRY (${body.percent}% off ${p.list_price.toFixed(2)} TRY).`,
        );
    }
  }
}
async function notify(c, userId, key, message) {
  await c.query(
    'INSERT INTO demo_notifications(id, customer_id, event_key, message) VALUES ($1,$2,$3,$4) ON CONFLICT (customer_id,event_key) DO NOTHING',
    [randomUUID(), userId, key, message],
  );
}
export async function saveWishlist(c, user, code, saved) {
  const p = (
    await c.query('SELECT id FROM products WHERE code=$1 AND NOT archived', [
      code,
    ])
  ).rows[0];
  if (!p) fail(404, 'Product not found.');
  if (saved)
    await c.query(
      'INSERT INTO wishlist_items(customer_id,product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [user.id, p.id],
    );
  else
    await c.query(
      'DELETE FROM wishlist_items WHERE customer_id=$1 AND product_id=$2',
      [user.id, p.id],
    );
}
export async function readNotification(c, user, id) {
  const r = await c.query(
    'UPDATE demo_notifications SET read_at=COALESCE(read_at,now()) WHERE id::text=$1 AND customer_id=$2',
    [id, user.id],
  );
  if (!r.rowCount) fail(404, 'Notification not found.');
}
export async function resolveReturn(c, user, id, action, body) {
  const r = (
    await c.query('SELECT * FROM return_requests WHERE id=$1 FOR UPDATE', [id])
  ).rows[0];
  if (!r) fail(404, 'Return request not found.');
  if (action === 'receive') {
    if (r.received_at || r.status === 'Approved') return;
    if (r.status !== 'Awaiting item')
      fail(409, 'Only an awaiting return can be received.');
    if (body.confirmed !== true)
      fail(400, 'Confirm the items physically arrived at the store.');
    await c.query(
      "UPDATE return_requests SET status='Received', received_at=now(), received_by=$2 WHERE id=$1",
      [id, user.id],
    );
    return;
  }
  if (action === 'reject') {
    if (r.status === 'Rejected') return;
    if (r.status === 'Approved')
      fail(409, 'An approved refund cannot be rejected.');
    const reason = text(body.reason, 'Rejection reason', 500);
    await c.query(
      "UPDATE return_requests SET status='Rejected', rejection_reason=$2, resolved_at=now(), resolved_by=$3 WHERE id=$1",
      [id, reason, user.id],
    );
    const order = (
      await c.query('SELECT customer_id FROM orders WHERE id=$1', [r.order_id])
    ).rows[0];
    await notify(
      c,
      order.customer_id,
      `return-rejected:${id}`,
      `Return ${id} for ${r.order_id} was rejected: ${reason}`,
    );
    return;
  }
  if (action !== 'approve') fail(400, 'Unknown return action.');
  if (r.status === 'Approved') return;
  if (r.status !== 'Received' || !r.received_at)
    fail(409, 'Confirm receipt at the store before approving this return.');
  const order = (
    await c.query('SELECT * FROM orders WHERE id=$1', [r.order_id])
  ).rows[0];
  const { rows } = await c.query(
    `SELECT ri.product_id, ri.quantity, oi.unit_price, oi.unit_cost
    FROM return_request_items ri JOIN order_items oi ON oi.order_id=$2 AND oi.product_id=ri.product_id
    WHERE ri.return_id=$1 ORDER BY ri.product_id`,
    [id, r.order_id],
  );
  const paid =
    rows.reduce(
      (sum, i) => sum + Math.round(i.unit_price * 100) * i.quantity,
      0,
    ) / 100;
  const cost =
    rows.reduce(
      (sum, i) => sum + Math.round(i.unit_cost * 100) * i.quantity,
      0,
    ) / 100;
  // Order-time snapshots, never today's product prices/costs.
  await c.query(
    'INSERT INTO refunds(return_id,amount,returned_cost,actor_id) VALUES ($1,$2,$3,$4)',
    [id, paid, cost, user.id],
  );
  for (const i of rows)
    await c.query(
      'UPDATE products SET stock_quantity=stock_quantity+$2 WHERE id=$1',
      [i.product_id, i.quantity],
    );
  await c.query(
    "UPDATE return_requests SET status='Approved', amount=$2, resolved_at=now(), resolved_by=$3 WHERE id=$1",
    [id, paid, user.id],
  );
  await notify(
    c,
    order.customer_id,
    `refund:${id}`,
    `Return ${id} approved. Demo refund: ${paid.toFixed(2)} TRY for ${r.order_id}. Returned items are back in stock.`,
  );
}
export function dateRange(query) {
  const valid = (s) =>
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number(s.slice(0, 4)) >= 1900 &&
    Number(s.slice(0, 4)) <= 2200 &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(query.from) || !valid(query.to) || query.from > query.to)
    fail(400, 'Choose a valid start and end date (start must not follow end).');
  return [query.from, query.to];
}
export async function salesWorkspace(c, query) {
  const [from, to] = dateRange(query);
  const { rows: invoices } = await c.query(
    `SELECT o.id, o.order_date AS date, o.status, u.name AS customer,
    sum(i.unit_price*i.quantity) AS total
    FROM orders o JOIN users u ON u.id=o.customer_id JOIN order_items i ON i.order_id=o.id
    WHERE o.order_date BETWEEN $1 AND $2 GROUP BY o.id,u.name ORDER BY o.order_date DESC,o.seq DESC`,
    [from, to],
  );
  const { rows: days } = await c.query(
    `WITH events AS (
    SELECT o.order_date AS day, sum(i.unit_price*i.quantity) AS gross, sum(i.unit_cost*i.quantity) AS cost, 0::numeric AS refunds, 0::numeric AS returned_cost
    FROM orders o JOIN order_items i ON i.order_id=o.id
    WHERE o.status <> 'Cancelled' AND o.order_date BETWEEN $1 AND $2 GROUP BY o.order_date
    UNION ALL
    SELECT (f.approved_at AT TIME ZONE 'UTC')::date AS day, 0, 0, sum(f.amount), sum(f.returned_cost)
    FROM refunds f WHERE (f.approved_at AT TIME ZONE 'UTC')::date BETWEEN $1 AND $2 GROUP BY day
  ) SELECT day, sum(gross) AS gross, sum(cost) AS cost, sum(refunds) AS refunds, sum(returned_cost) AS returned_cost
    FROM events GROUP BY day ORDER BY day`,
    [from, to],
  );
  const totals = { gross: 0, cost: 0, refunds: 0, returnedCost: 0 };
  const series = days.map((d) => {
    const item = {
      date: d.day,
      gross: d.gross,
      cost: d.cost,
      refunds: d.refunds,
      returnedCost: d.returned_cost,
    };
    for (const key of Object.keys(totals))
      totals[key] += Math.round(item[key] * 100);
    return {
      ...item,
      net: Math.round((d.gross - d.refunds) * 100) / 100,
      profit:
        Math.round((d.gross - d.refunds - d.cost + d.returned_cost) * 100) /
        100,
    };
  });
  for (const key of Object.keys(totals)) totals[key] /= 100;
  totals.net = Math.round((totals.gross - totals.refunds) * 100) / 100;
  totals.netCost = Math.round((totals.cost - totals.returnedCost) * 100) / 100;
  totals.profit = Math.round((totals.net - totals.netCost) * 100) / 100;
  const returns = (
    await c.query(`SELECT r.id,r.order_id AS "orderId",r.status,r.amount,r.received_at AS "receivedAt",r.rejection_reason AS reason,u.name AS customer,
      json_agg(json_build_object('id',p.code,'name',i.product_name,'qty',ri.quantity,'price',i.unit_price) ORDER BY p.id) AS items
      FROM return_requests r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=o.customer_id
      JOIN return_request_items ri ON ri.return_id=r.id JOIN products p ON p.id=ri.product_id
      JOIN order_items i ON i.order_id=o.id AND i.product_id=ri.product_id
      GROUP BY r.id,u.name ORDER BY r.created_at DESC`)
  ).rows;
  return { from, to, invoices, series, totals, returns };
}
