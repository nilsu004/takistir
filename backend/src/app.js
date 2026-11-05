import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { passwordHash, passwordMatches } from './passwords.js';
import {
  addCategory,
  archiveProduct,
  cancelOrder,
  customer,
  fail,
  findUser,
  invoiceFor,
  manager,
  moderateReview,
  placeOrder,
  removeCategory,
  requestReturn,
  saveProduct,
  setStock,
  submitReview,
  text,
  updateProfile,
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

// PostgreSQL error codes that mean the request conflicts with stored data.
const pgErrors = {
  23505: [409, 'This value is already in use.'],
  23503: [409, 'This record is referenced by other data.'],
  23514: [400, 'A value is outside the allowed range.'],
  '40P01': [409, 'The request conflicted with another one. Please try again.'],
};

export function createApp({
  db,
  allowedOrigins = [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:5174',
    'http://localhost:5174',
  ],
} = {}) {
  if (!db) throw new Error('A database is required.');
  // Express 5 forwards rejected promises from async handlers to the error
  // handler below, so services can simply throw fail(...).
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
  app.use('/api', async (req, _res, next) => {
    const match = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`));
    req.sessionHash = match
      ? tokenHash(match.slice(cookieName.length + 1))
      : null;
    req.user = null;
    if (req.sessionHash) {
      const { rows } = await db.query(
        `SELECT u.id, u.name, u.email, u.home_address, u.tax_id, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [req.sessionHash],
      );
      req.user = rows[0] ?? null;
    }
    next();
  });
  // The state is read in one REPEATABLE READ snapshot so all lists agree.
  const snapshot = (user) => db.tx((c) => view(c, user), { readOnly: true });
  const bumpRevision = () => db.query("SELECT nextval('state_revision')");
  const send = async (req, res, result = null) =>
    res.json({ data: result, state: await snapshot(req.user) });
  async function newSession(req, res, user) {
    if (req.sessionHash)
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [
        req.sessionHash,
      ]);
    await db.query('DELETE FROM sessions WHERE expires_at <= now()');
    const token = randomBytes(32).toString('hex');
    await db.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + interval '8 hours')`,
      [tokenHash(token), user.id],
    );
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: 8 * 3600000 });
    req.user = user;
  }
  const attempts = new Map();
  app.post('/api/auth/login', async (req, res) => {
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
    const user = await findUser(db, 'email', email);
    if (!user || !passwordMatches(password, user.password_hash))
      fail(401, 'Email or password is incorrect.');
    attempts.delete(key);
    delete user.password_hash;
    await newSession(req, res, user);
    await send(req, res);
  });
  app.post('/api/auth/register', async (req, res) => {
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
    const { rows } = await db.query(
      `INSERT INTO users (id, email, name, role, password_hash)
       VALUES ($1, $2, $3, 'customer', $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, name, email, home_address, tax_id, role`,
      [`CU-${randomUUID()}`, email, name, passwordHash(password)],
    );
    if (!rows.length) fail(409, 'This email is already registered.');
    await bumpRevision();
    await newSession(req, res, rows[0]);
    await send(req, res);
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (req.sessionHash)
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [
        req.sessionHash,
      ]);
    req.user = null;
    res.clearCookie(cookieName, cookieOptions);
    await send(req, res);
  });
  app.get('/api/state', (req, res) => send(req, res));
  // Every state change: role check → one transaction → revision bump → snapshot.
  function mutation(path, role, fn, method = 'post') {
    app[method](path, async (req, res) => {
      role(req.user);
      const result = await db.tx((c) => fn(c, req));
      await bumpRevision();
      if (req.user) req.user = await findUser(db, 'id', req.user.id);
      if (req.user) delete req.user.password_hash;
      res.json({ data: result ?? null, state: await snapshot(req.user) });
    });
  }
  mutation(
    '/api/profile',
    (u) => {
      if (!u) fail(401, 'Sign in first.');
    },
    (c, req) => updateProfile(c, req.user, req.body),
    'patch',
  );
  mutation('/api/manager/products', manager, (c, r) =>
    saveProduct(c, r.body || {}),
  );
  mutation(
    '/api/manager/products/:id',
    manager,
    (c, r) => saveProduct(c, r.body || {}, r.params.id),
    'put',
  );
  mutation(
    '/api/manager/products/:id',
    manager,
    (c, r) => archiveProduct(c, r.params.id),
    'delete',
  );
  mutation(
    '/api/manager/products/:id/stock',
    manager,
    (c, r) => setStock(c, r.params.id, r.body?.stock),
    'patch',
  );
  mutation('/api/manager/categories', manager, (c, r) =>
    addCategory(c, r.body?.name),
  );
  mutation(
    '/api/manager/categories/:name',
    manager,
    (c, r) => removeCategory(c, r.params.name),
    'delete',
  );
  mutation(
    '/api/manager/orders/:id/status',
    manager,
    (c, r) => updateStatus(c, r.params.id, r.body?.status),
    'patch',
  );
  mutation(
    '/api/manager/reviews/:id',
    manager,
    (c, r) => moderateReview(c, r.params.id, r.body?.status),
    'patch',
  );
  mutation('/api/orders', customer, (c, r) =>
    placeOrder(c, r.user, r.body || {}),
  );
  mutation('/api/orders/:id/cancel', customer, (c, r) =>
    cancelOrder(c, r.user, r.params.id),
  );
  mutation('/api/orders/:id/returns', customer, (c, r) =>
    requestReturn(c, r.user, r.params.id, r.body?.selected),
  );
  mutation('/api/reviews', customer, (c, r) =>
    submitReview(c, r.user, r.body || {}),
  );
  app.get('/api/orders/:id/invoice', async (req, res) => {
    if (!req.user) fail(401, 'Sign in first.');
    res.json(
      await db.tx((c) => invoiceFor(c, req.user, req.params.id), {
        readOnly: true,
      }),
    );
  });
  app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Invalid JSON body.' });
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Request body too large.' });
    if (!error.status && pgErrors[error.code])
      [error.status, error.message] = pgErrors[error.code];
    if (!error.status) console.error(error);
    res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : 'Internal server error.' });
  });
  return app;
}
