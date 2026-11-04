import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { products, initialOrders } from '../../shared/seed.js';
import { initialCategories } from '../../shared/catalog-rules.js';

export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(
    Buffer.from(hash, 'hex'),
    scryptSync(password, salt, 64),
  );
}
export function initialState() {
  return {
    revision: 1,
    products: products.map((p) => ({
      ...p,
      warranty: '2 years',
      distributor: 'Takıştır',
      ratingCount: p.popularity,
    })),
    categories: initialCategories,
    orders: initialOrders.map((o) => ({
      ...o,
      customerId: 'CU-001',
      deliveryId: `DL-${o.id}`,
      inventoryReserved: false,
      address:
        'Deniz Yılmaz · Örnek Mah. Demo Sok. No: 12, Kadıköy, İstanbul 34710',
      items: o.items.map((i) => ({
        ...i,
        name: products.find((p) => p.id === i.id).name,
        image: products.find((p) => p.id === i.id).image,
      })),
    })),
    reviews: [
      {
        id: 'RV-PUBLISHED',
        productId: 'TK-001',
        customerId: 'CU-SEED',
        author: 'A',
        rating: 5,
        comment: 'Elegant and suitable for everyday wear.',
        status: 'Approved',
      },
      {
        id: 'RV-DEMO',
        productId: 'TK-002',
        customerId: 'CU-001',
        author: 'Deniz Yılmaz',
        rating: 5,
        comment: 'Lovely pearl detail and comfortable to wear.',
        status: 'Pending',
      },
    ],
    users: [
      {
        id: 'CU-001',
        name: 'Deniz Yılmaz',
        email: 'deniz@example.com',
        home: 'İstanbul',
        taxId: 'DEMO-001',
        role: 'customer',
        passwordHash: passwordHash('CustomerDemo!24'),
      },
      {
        id: 'PM-001',
        name: 'Product Manager',
        email: 'manager@takistir.local',
        home: '',
        taxId: '',
        role: 'product-manager',
        passwordHash: passwordHash('ManagerDemo!24'),
      },
    ],
  };
}

// Local integration adapter. Each write reads and updates the snapshot under
// one SQLite write transaction, so checkout/stock/moderation cannot lose updates.
export function createStore(filename) {
  if (filename !== ':memory:')
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);`);
  if (!db.prepare('SELECT id FROM app_state WHERE id = 1').get()) {
    db.prepare('INSERT OR IGNORE INTO app_state VALUES (1, ?)').run(
      JSON.stringify(initialState()),
    );
  }
  const read = () =>
    JSON.parse(
      db.prepare('SELECT json FROM app_state WHERE id = 1').get().json,
    );
  return {
    db,
    read,
    write(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const state = read();
        const result = fn(state);
        state.revision += 1;
        db.prepare('UPDATE app_state SET json = ? WHERE id = 1').run(
          JSON.stringify(state),
        );
        db.exec('COMMIT');
        return { state, result };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
