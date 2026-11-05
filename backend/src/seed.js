import { products, initialOrders } from '../../shared/seed.js';
import { initialCategories } from '../../shared/catalog-rules.js';
import { passwordHash } from './passwords.js';

// Local development/test accounts. Never seeded in production.
export const demoAccounts = [
  {
    id: 'CU-001',
    name: 'Deniz Yılmaz',
    email: 'deniz@example.com',
    home: 'İstanbul',
    taxId: 'DEMO-001',
    role: 'customer',
    password: 'CustomerDemo!24',
  },
  {
    id: 'PM-001',
    name: 'Product Manager',
    email: 'manager@takistir.local',
    home: '',
    taxId: '',
    role: 'product-manager',
    password: 'ManagerDemo!24',
  },
];

/**
 * Loads the storefront demo catalogue, accounts, orders and reviews into an
 * empty database (the same data the former SQLite adapter created).
 * Does nothing when any user already exists. Returns true if it seeded.
 */
export async function seedDemoData(db) {
  return db.tx(async (c) => {
    await c.query('LOCK TABLE users IN EXCLUSIVE MODE');
    if ((await c.query('SELECT 1 FROM users LIMIT 1')).rowCount) return false;

    const categoryIds = new Map();
    for (const name of initialCategories) {
      const { rows } = await c.query(
        `INSERT INTO categories (name) VALUES ($1)
         ON CONFLICT ((lower(btrim(name)))) DO UPDATE SET archived = FALSE
         RETURNING id`,
        [name],
      );
      categoryIds.set(name, rows[0].id);
    }

    const productIds = new Map();
    for (const p of products) {
      const { rows } = await c.query(
        `INSERT INTO products (code, category_id, name, model, serial_number,
           description, stock_quantity, price, warranty_status, distributor,
           material, image, detail_image, collection, popularity,
           seed_rating, seed_rating_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [
          p.id,
          categoryIds.get(p.category),
          p.name,
          p.model,
          p.serial,
          p.description,
          p.stock,
          p.price,
          '2 years',
          'Takıştır',
          p.material,
          p.image,
          p.detailImage ?? null,
          p.collection,
          p.popularity,
          p.rating,
          p.popularity,
        ],
      );
      productIds.set(p.id, rows[0].id);
    }

    for (const u of demoAccounts)
      await c.query(
        `INSERT INTO users (id, name, email, home_address, tax_id, role, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          u.id,
          u.name,
          u.email,
          u.home,
          u.taxId,
          u.role,
          passwordHash(u.password),
        ],
      );

    // Inserted oldest-first so the history (newest first) keeps the seed order.
    for (const o of [...initialOrders].reverse()) {
      await c.query(
        `INSERT INTO orders (id, customer_id, delivery_id, order_date, status,
           delivery_address, tracking_number, inventory_reserved)
         VALUES ($1, 'CU-001', $2, $3, $4, $5, $6, FALSE)`,
        [
          o.id,
          `DL-${o.id}`,
          o.date,
          o.status,
          'Deniz Yılmaz · Örnek Mah. Demo Sok. No: 12, Kadıköy, İstanbul 34710',
          o.tracking ?? null,
        ],
      );
      for (const [position, item] of o.items.entries()) {
        const p = products.find((p) => p.id === item.id);
        await c.query(
          `INSERT INTO order_items (order_id, product_id, position, product_name,
             product_image, quantity, unit_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            o.id,
            productIds.get(item.id),
            position,
            p.name,
            p.image,
            item.qty,
            item.price,
          ],
        );
      }
    }

    const reviews = [
      [
        'RV-PUBLISHED',
        'TK-001',
        null,
        'A',
        5,
        'Elegant and suitable for everyday wear.',
        'Approved',
      ],
      [
        'RV-DEMO',
        'TK-002',
        'CU-001',
        'Deniz Yılmaz',
        5,
        'Lovely pearl detail and comfortable to wear.',
        'Pending',
      ],
    ];
    for (const [
      id,
      code,
      customerId,
      author,
      rating,
      comment,
      status,
    ] of reviews)
      await c.query(
        `INSERT INTO reviews (id, product_id, customer_id, author_name, rating, comment, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, productIds.get(code), customerId, author, rating, comment, status],
      );
    return true;
  });
}
