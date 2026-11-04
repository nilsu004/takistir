import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore, passwordHash, passwordMatches } from './store.js';
import {
  cancelOrder,
  customer,
  fail,
  manager,
  orderFor,
  placeOrder,
  publicUser,
  requestReturn,
  saveProduct,
  setStock,
  submitReview,
  text,
  updateStatus,
  view,
} from './service.js';

const cookieName = 'takistir_session';
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export function createApp({
  store,
  allowedOrigins = [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:5174',
    'http://localhost:5174',
  ],
} = {}) {
  if (!store) throw new Error('A store is required.');
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', service: 'takistir-api' }),
  );
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('X-Takistir-Request') !== '1')
        return next(
          Object.assign(new Error('Missing request protection header.'), {
            status: 403,
          }),
        );
      if (req.get('Origin') && !allowedOrigins.includes(req.get('Origin')))
        return next(
          Object.assign(new Error('Untrusted request origin.'), {
            status: 403,
          }),
        );
      if (req.get('Sec-Fetch-Site') === 'cross-site')
        return next(
          Object.assign(new Error('Cross-site requests are not permitted.'), {
            status: 403,
          }),
        );
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', (req, _res, next) => {
    const match = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`));
    req.sessionHash = match
      ? tokenHash(match.slice(cookieName.length + 1))
      : null;
    const session =
      req.sessionHash &&
      store.db
        .prepare(
          'SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?',
        )
        .get(req.sessionHash, Date.now());
    req.user = session
      ? store.read().users.find((u) => u.id === session.user_id)
      : null;
    next();
  });
  const snapshot = (state, userId) =>
    view(
      state,
      state.users.find((u) => u.id === userId),
    );
  const send = (req, res, result = null) =>
    res.json({ data: result, state: snapshot(store.read(), req.user?.id) });
  function newSession(req, res, user) {
    if (req.sessionHash)
      store.db
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .run(req.sessionHash);
    store.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    store.db
      .prepare('INSERT INTO sessions VALUES (?, ?, ?)')
      .run(tokenHash(token), user.id, Date.now() + 8 * 3600000);
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: 8 * 3600000 });
    req.user = user;
  }
  // Local demo credentials are intentionally enabled only in development.
  const attempts = new Map();
  app.post('/api/auth/login', (req, res) => {
    const now = Date.now();
    for (const [key, row] of attempts)
      if (row.until < now) attempts.delete(key);
    const key = req.ip;
    const attempt = attempts.get(key) || { count: 0, until: now + 60000 };
    if (attempt.count >= 15)
      fail(429, 'Too many login attempts. Try again in one minute.');
    attempt.count += 1;
    attempts.set(key, attempt);
    const email = text(req.body?.email, 'Email', 254).toLowerCase();
    const password = text(req.body?.password, 'Password', 128);
    const user = store.read().users.find((u) => u.email === email);
    if (!user || !passwordMatches(password, user.passwordHash))
      fail(401, 'Email or password is incorrect.');
    attempts.delete(key);
    newSession(req, res, user);
    send(req, res);
  });
  app.post('/api/auth/register', (req, res) => {
    const body = req.body || {};
    const email = text(body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, 'Enter a valid email address.');
    const password = text(body.password, 'Password', 128);
    if (password.length < 8)
      fail(400, 'Password must contain at least 8 characters.');
    if (body.role && body.role !== 'customer')
      fail(403, 'Self-registration creates customer accounts only.');
    const name = text(body.name, 'Name');
    const user = {
      id: `CU-${randomUUID()}`,
      email,
      name,
      home: '',
      taxId: '',
      role: 'customer',
      passwordHash: passwordHash(password),
    };
    store.write((state) => {
      if (state.users.some((u) => u.email === email))
        fail(409, 'This email is already registered.');
      state.users.push(user);
    });
    newSession(req, res, user);
    send(req, res);
  });
  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionHash)
      store.db
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .run(req.sessionHash);
    req.user = null;
    res.clearCookie(cookieName, cookieOptions);
    send(req, res);
  });
  app.get('/api/state', (req, res) => send(req, res));
  function mutation(path, role, fn, method = 'post') {
    app[method](path, (req, res) => {
      role(req.user);
      const { state, result } = store.write((state) => fn(state, req));
      res.json({ data: result ?? null, state: snapshot(state, req.user.id) });
    });
  }
  mutation(
    '/api/profile',
    (u) => {
      if (!u) fail(401, 'Sign in first.');
    },
    (s, req) => {
      const u = s.users.find((u) => u.id === req.user.id);
      const name = text(req.body?.name, 'Name');
      const email = text(req.body?.email, 'Email', 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        fail(400, 'Enter a valid email address.');
      if (s.users.some((v) => v.id !== u.id && v.email === email))
        fail(409, 'This email is already registered.');
      if (typeof req.body.home !== 'string' || req.body.home.length > 500)
        fail(400, 'Home address must contain at most 500 characters.');
      Object.assign(u, { name, email, home: req.body.home.trim() });
      return publicUser(u);
    },
    'patch',
  );
  mutation('/api/manager/products', manager, (s, r) =>
    saveProduct(s, r.body || {}),
  );
  mutation(
    '/api/manager/products/:id',
    manager,
    (s, r) => saveProduct(s, r.body || {}, r.params.id),
    'put',
  );
  mutation(
    '/api/manager/products/:id',
    manager,
    (s, r) => {
      const p = s.products.find((p) => p.id === r.params.id && !p.archived);
      if (!p) fail(404, 'Product not found.');
      p.archived = true;
    },
    'delete',
  );
  mutation(
    '/api/manager/products/:id/stock',
    manager,
    (s, r) => setStock(s, r.params.id, r.body?.stock),
    'patch',
  );
  mutation('/api/manager/categories', manager, (s, r) => {
    const name = text(r.body?.name, 'Category', 60);
    if (
      ['New arrivals', 'All accessories', ...s.categories].some(
        (c) => c.toLowerCase() === name.toLowerCase(),
      )
    )
      fail(409, 'This category name is already used or reserved.');
    s.categories.push(name);
  });
  mutation(
    '/api/manager/categories/:name',
    manager,
    (s, r) => {
      if (!s.categories.includes(r.params.name))
        fail(404, 'Category not found.');
      if (s.products.some((p) => !p.archived && p.category === r.params.name))
        fail(409, 'Move or remove products in this category first.');
      s.categories = s.categories.filter((c) => c !== r.params.name);
    },
    'delete',
  );
  mutation(
    '/api/manager/orders/:id/status',
    manager,
    (s, r) => updateStatus(s, r.params.id, r.body?.status),
    'patch',
  );
  mutation(
    '/api/manager/reviews/:id',
    manager,
    (s, r) => {
      const review = s.reviews.find((v) => v.id === r.params.id);
      if (!review) fail(404, 'Review not found.');
      if (review.status !== 'Pending')
        fail(409, 'This review has already been moderated.');
      if (!['Approved', 'Rejected'].includes(r.body?.status))
        fail(400, 'Choose Approved or Rejected.');
      review.status = r.body.status;
    },
    'patch',
  );
  mutation('/api/orders', customer, (s, r) =>
    placeOrder(s, r.user, r.body || {}),
  );
  mutation('/api/orders/:id/cancel', customer, (s, r) =>
    cancelOrder(s, r.user, r.params.id),
  );
  mutation('/api/orders/:id/returns', customer, (s, r) =>
    requestReturn(s, r.user, r.params.id, r.body?.selected),
  );
  mutation('/api/reviews', customer, (s, r) =>
    submitReview(s, r.user, r.body || {}),
  );
  app.get('/api/orders/:id/invoice', (req, res) => {
    if (!req.user) fail(401, 'Sign in first.');
    const order = orderFor(store.read(), req.user, req.params.id);
    const { checkoutKey: _, inventoryReserved: __, ...invoice } = order;
    res.json(invoice);
  });
  app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Invalid JSON body.' });
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Request body too large.' });
    if (!error.status) console.error(error);
    res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : 'Internal server error.' });
  });
  return app;
}

export function createLocalApp() {
  if (process.env.NODE_ENV === 'production')
    throw new Error(
      'The seeded SQLite adapter is for local integration only. Configure a production database and account provisioning first.',
    );
  const filename =
    process.env.LOCAL_DB_PATH ||
    fileURLToPath(new URL('../data/local.sqlite', import.meta.url));
  const store = createStore(filename);
  return { app: createApp({ store }), store };
}
