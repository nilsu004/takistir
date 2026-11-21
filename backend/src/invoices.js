import { randomUUID } from 'node:crypto';

/** Capture one invoice and queue its email inside the checkout transaction. */
export async function storeInvoice(c, orderId, { queueEmail = true } = {}) {
  const { rows } = await c.query(
    `INSERT INTO invoices
       (order_id, number, customer_name, customer_email, tax_id, delivery_address, order_date, total)
     SELECT o.id, 'TK-F-' || regexp_replace(o.id, '^TK-', ''), u.name, u.email, u.tax_id, o.delivery_address, o.order_date,
       sum(i.quantity * i.unit_price)
     FROM orders o JOIN users u ON u.id = o.customer_id
     JOIN order_items i ON i.order_id = o.id
     WHERE o.id = $1 GROUP BY o.id, u.id
     ON CONFLICT (order_id) DO NOTHING RETURNING order_id`,
    [orderId],
  );
  if (!rows.length) return;
  await c.query(
    `INSERT INTO invoice_items
       (order_id, position, product_code, product_name, product_image, quantity, unit_price)
     SELECT i.order_id, i.position, p.code, i.product_name, i.product_image,
       i.quantity, i.unit_price
     FROM order_items i JOIN products p ON p.id = i.product_id
     WHERE i.order_id = $1`,
    [orderId],
  );
  if (queueEmail)
    await c.query('INSERT INTO invoice_emails (order_id) VALUES ($1)', [
      orderId,
    ]);
}

/** Caller must authorize the order before reading this internal snapshot. */
export async function loadInvoice(c, orderId) {
  const { rows } = await c.query('SELECT * FROM invoices WHERE order_id = $1', [
    orderId,
  ]);
  if (!rows.length) return null;
  const invoice = rows[0];
  const { rows: items } = await c.query(
    `SELECT product_code AS id, product_name AS name, product_image AS image,
       quantity AS qty, unit_price AS price
     FROM invoice_items WHERE order_id = $1 ORDER BY position`,
    [orderId],
  );
  return {
    invoiceNumber: invoice.number,
    customerName: invoice.customer_name,
    customerEmail: invoice.customer_email,
    taxId: invoice.tax_id,
    address: invoice.delivery_address,
    date: invoice.order_date,
    currency: invoice.currency,
    total: invoice.total,
    items,
  };
}

/**
 * Internal SCRUM-61 worker contract. A lease lets an interrupted send be retried.
 * The mail provider should deduplicate by the stable invoice number.
 */
export async function claimInvoiceEmail(c, orderId) {
  const { rows } = await c.query(
    `UPDATE invoice_emails SET status = 'sending', attempt_count = attempt_count + 1,
       claim_token = $2, lease_until = now() + interval '5 minutes', updated_at = now()
     WHERE order_id = $1 AND (status IN ('pending', 'failed')
       OR (status = 'sending' AND lease_until <= now()))
     RETURNING order_id, claim_token, attempt_count`,
    [orderId, randomUUID()],
  );
  return rows[0] ?? null;
}

/** A stale worker cannot finish a newer send attempt or overwrite a sent email. */
export async function finishInvoiceEmail(c, orderId, claimToken, sent) {
  if (typeof sent !== 'boolean') throw new TypeError('sent must be a boolean.');
  const { rows } = await c.query(
    `UPDATE invoice_emails SET status = $3::varchar,
       sent_at = CASE WHEN $3::varchar = 'sent' THEN now() ELSE NULL END,
       claim_token = NULL, lease_until = NULL, updated_at = now()
     WHERE order_id = $1 AND status = 'sending' AND claim_token = $2
     RETURNING order_id, status, attempt_count, sent_at`,
    [orderId, claimToken, sent ? 'sent' : 'failed'],
  );
  return rows[0] ?? null;
}
