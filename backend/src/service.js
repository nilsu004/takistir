import { randomUUID } from 'node:crypto';
import { returnEligible } from '../../shared/order-rules.js';
import {
  canTransition,
  publishedRating,
  validateProduct,
} from '../../shared/catalog-rules.js';

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
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash: _, ...safe } = user;
  return safe;
}
export function view(state, user) {
  const isManager = user?.role === 'product-manager';
  const orders = user
    ? state.orders.filter((o) => isManager || o.customerId === user.id)
    : [];
  const historicalIds = new Set(
    orders.flatMap((o) => o.items.map((i) => i.id)),
  );
  return {
    revision: state.revision,
    user: publicUser(user),
    categories: state.categories,
    products: state.products
      .filter((p) => !p.archived || isManager || historicalIds.has(p.id))
      .map((p) => ({
        ...p,
        publishedRating: publishedRating(p, state.reviews),
      })),
    orders: orders.map(
      ({ checkoutKey: _, inventoryReserved: __, ...order }) => order,
    ),
    reviews: state.reviews
      .filter(
        (r) =>
          isManager || r.status === 'Approved' || r.customerId === user?.id,
      )
      .map((r) =>
        isManager || r.customerId === user?.id
          ? r
          : {
              id: r.id,
              productId: r.productId,
              author: `${r.author.slice(0, 1)}***`,
              rating: r.rating,
              comment: r.comment,
              status: r.status,
            },
      ),
  };
}
export function saveProduct(state, body, editingId) {
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
  const error = validateProduct(
    draft,
    state.products,
    state.categories,
    editingId,
  );
  if (error) fail(400, error);
  if (editingId) {
    const p = state.products.find((p) => p.id === editingId && !p.archived);
    if (!p) fail(404, 'Product not found.');
    if (p.image !== draft.image) delete p.detailImage;
    Object.assign(p, draft);
  } else
    state.products.push({
      ...draft,
      price: null,
      rating: 0,
      ratingCount: 0,
      popularity: 0,
      collection: 'New arrivals',
    });
}
export function setStock(state, id, stock) {
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000)
    fail(400, 'Stock must be a whole number between 0 and 1,000,000.');
  const product = state.products.find((p) => p.id === id && !p.archived);
  if (!product) fail(404, 'Product not found.');
  product.stock = stock;
}
export function orderFor(state, user, id) {
  const order = state.orders.find(
    (o) =>
      o.id === id &&
      (user?.role === 'product-manager' || o.customerId === user?.id),
  );
  if (!order) fail(404, 'Order not found.');
  return order;
}
export function placeOrder(state, user, body) {
  customer(user);
  const key = text(body.key, 'Checkout key', 100);
  const prior = state.orders.find(
    (o) => o.customerId === user.id && o.checkoutKey === key,
  );
  if (prior) return prior.id;
  if (
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 100
  )
    fail(400, 'Your cart must contain 1–100 items.');
  const ids = new Set();
  const items = body.items.map((item) => {
    if (!item || ids.has(item.id)) fail(400, 'Duplicate or invalid cart item.');
    ids.add(item.id);
    const p = state.products.find((p) => p.id === item.id && !p.archived);
    if (
      !p ||
      p.price === null ||
      !Number.isSafeInteger(item.qty) ||
      item.qty < 1 ||
      item.qty > p.stock
    )
      fail(409, 'Stock or availability changed. Please review your cart.');
    return {
      id: p.id,
      name: p.name,
      image: p.image,
      qty: item.qty,
      price: p.price,
    };
  });
  const address = body.address || {};
  const line = `${text(address.name, 'Recipient')} · ${text(address.street, 'Street', 300)}, ${text(address.city, 'City')} ${text(address.postcode, 'Postcode', 20)}`;
  for (const item of items)
    state.products.find((p) => p.id === item.id).stock -= item.qty;
  let nextNumber = state.nextOrderNumber || 1025;
  while (state.orders.some((order) => order.id === `TK-${nextNumber}`))
    nextNumber += 1;
  state.nextOrderNumber = nextNumber + 1;
  const id = `TK-${nextNumber}`;
  state.orders.unshift({
    id,
    customerId: user.id,
    deliveryId: `DL-${id}`,
    date: new Date().toISOString().slice(0, 10),
    status: 'Processing',
    items,
    address: line,
    checkoutKey: key,
    inventoryReserved: true,
  });
  return id;
}
export function updateStatus(state, id, status) {
  const order = state.orders.find((o) => o.id === id);
  if (!order) fail(404, 'Order not found.');
  if (!canTransition(order.status, status))
    fail(409, 'Orders must progress Processing → In transit → Delivered.');
  order.status = status;
}
export function cancelOrder(state, user, id) {
  customer(user);
  const order = orderFor(state, user, id);
  if (order.status !== 'Processing')
    fail(409, 'Only Processing orders can be cancelled.');
  order.status = 'Cancelled';
  if (order.inventoryReserved)
    for (const item of order.items)
      state.products.find((p) => p.id === item.id).stock += item.qty;
}
export function submitReview(state, user, body) {
  customer(user);
  if (
    !state.orders.some(
      (o) =>
        o.customerId === user.id &&
        o.status === 'Delivered' &&
        o.items.some((i) => i.id === body.productId),
    )
  )
    fail(403, 'Only delivered purchases can be reviewed.');
  if (!state.products.some((p) => p.id === body.productId && !p.archived))
    fail(404, 'Product not found.');
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)
    fail(400, 'Rating must be between 1 and 5.');
  state.reviews.push({
    id: randomUUID(),
    productId: body.productId,
    rating: body.rating,
    comment: text(body.comment, 'Comment', 500),
    customerId: user.id,
    author: user.name,
    status: 'Pending',
  });
}
export function requestReturn(state, user, id, selected) {
  customer(user);
  const order = orderFor(state, user, id);
  if (!returnEligible(order) || order.returnRequest)
    fail(409, 'This order is not eligible for a new return request.');
  if (
    !selected ||
    typeof selected !== 'object' ||
    Array.isArray(selected) ||
    !Object.keys(selected).length
  )
    fail(400, 'Select items to return.');
  const items = Object.entries(selected).map(([id, qty]) => {
    const item = order.items.find((i) => i.id === id);
    if (!item || !Number.isInteger(qty) || qty < 1 || qty > item.qty)
      fail(400, 'Invalid return quantity.');
    return { ...item, qty };
  });
  order.returnRequest = {
    id: `R-${randomUUID()}`,
    status: 'Awaiting item',
    items,
    amount: items.reduce((sum, i) => sum + i.price * i.qty, 0),
  };
}
