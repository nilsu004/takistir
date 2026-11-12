import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  catalogProducts,
  publishedRating,
  validateProduct,
} from './model.js';

const product = {
  id: 'TK-TEST',
  name: 'Watch',
  category: 'Watches',
  model: 'M1',
  serial: 'SN-1',
  description: 'A steel watch.',
  warranty: '2 years',
  distributor: 'Takıştır',
  material: 'Steel',
  stock: 1,
  image: 'ring-card.svg',
};
const validate = (draft, rows = [], editingId) =>
  validateProduct(draft, rows, ['Watches'], editingId);

test('required product details, valid category and integer stock are enforced', () => {
  assert.equal(validate(product), '');
  for (const change of [
    { name: ' ' },
    { warranty: '' },
    { distributor: '' },
    { category: 'Unknown' },
    { stock: -1 },
    { stock: 0.5 },
    { stock: Infinity },
    { stock: 1000001 },
  ]) {
    assert.notEqual(validate({ ...product, ...change }), '');
  }
  assert.equal(validate({ ...product, stock: 0 }), '');
});

test('removed IDs and serials cannot be reused; existing IDs are immutable', () => {
  const archived = { ...product, archived: true };
  assert.match(validate(product, [archived]), /already in use/);
  assert.match(validate({ ...product, id: 'TK-OTHER' }, [archived]), /Serial/);
  assert.equal(validate(product, [product], product.id), '');
  assert.match(
    validate({ ...product, id: 'TK-CHANGED' }, [product], product.id),
    /cannot be changed/,
  );
});

test('delivery states progress in sequence and terminal states cannot change', () => {
  assert(canTransition('Processing', 'In transit'));
  assert(canTransition('In transit', 'Delivered'));
  for (const pair of [
    ['Processing', 'Delivered'],
    ['Delivered', 'Processing'],
    ['Cancelled', 'Processing'],
    ['Processing', 'Processing'],
    ['Delivered', 'unknown'],
  ])
    assert.equal(canTransition(...pair), false);
});

test('ratings publish immediately regardless of comment moderation', () => {
  const p = { id: 'TK-TEST', rating: 4, ratingCount: 2 };
  const reviews = [
    { productId: p.id, rating: 1, status: 'Pending' },
    { productId: p.id, rating: 1, status: 'Rejected' },
    { productId: 'other', rating: 1, status: 'Approved' },
  ];
  assert.deepEqual(publishedRating(p, reviews), { count: 4, rating: '2.5' });
  assert.deepEqual(
    publishedRating(p, [
      ...reviews,
      { productId: p.id, rating: 5, status: 'Approved' },
    ]),
    { count: 5, rating: '3.0' },
  );
  assert.equal(publishedRating({ id: 'new' }, []).count, 0);
});

test('return windows include new deliveries and day 30, but exclude future, old and undelivered orders', async () => {
  const { returnEligible } = await import('../../../shared/order-rules.js');
  const now = new Date('2026-11-04T01:00:00Z');
  const eligible = (date, status = 'Delivered') =>
    returnEligible({ date, status }, now);
  assert.equal(eligible('2026-11-04'), true);
  assert.equal(eligible('2026-10-05'), true);
  assert.equal(eligible('2026-10-04'), false);
  assert.equal(eligible('2026-11-05'), false);
  assert.equal(eligible('2026-11-04', 'Processing'), false);
});

test('API rating aggregates take precedence over the visible comment subset', () => {
  const published = { count: 4, rating: '3.5' };
  assert.deepEqual(
    publishedRating({ id: 'x', publishedRating: published }, []),
    published,
  );
});

test('price sorting keeps unpriced products last in both directions, including zero prices', () => {
  const rows = [
    { id: 'pending', price: null },
    { id: 'expensive', price: 20 },
    { id: 'free', price: 0 },
    { id: 'cheap', price: 10 },
  ];
  assert.deepEqual(
    catalogProducts(rows, { sort: 'low' }).map((p) => p.id),
    ['free', 'cheap', 'expensive', 'pending'],
  );
  assert.deepEqual(
    catalogProducts(rows, { sort: 'high' }).map((p) => p.id),
    ['expensive', 'cheap', 'free', 'pending'],
  );
  assert.equal(rows[0].id, 'pending');
});

test('search includes descriptions and sold-out products; filters combine and archives stay hidden', () => {
  const rows = [
    {
      id: 'a',
      name: 'Pearl',
      description: 'Gold finish',
      category: 'Rings',
      stock: 0,
      popularity: 2,
    },
    {
      id: 'b',
      name: 'Gold watch',
      description: 'Steel',
      category: 'Watches',
      stock: 3,
      popularity: 4,
    },
    {
      id: 'c',
      name: 'Gold',
      description: '',
      category: 'Rings',
      stock: 1,
      archived: true,
    },
  ];
  assert.deepEqual(
    catalogProducts(rows, { query: '  GOLD  ' }).map((p) => p.id),
    ['b', 'a'],
  );
  assert.deepEqual(
    catalogProducts(rows, { query: 'gold', category: 'Rings' }).map(
      (p) => p.id,
    ),
    ['a'],
  );
  assert.deepEqual(
    catalogProducts(rows, { query: 'gold', availability: 'in-stock' }).map(
      (p) => p.id,
    ),
    ['b'],
  );
  assert.deepEqual(catalogProducts(rows, { query: 'missing' }), []);
});
