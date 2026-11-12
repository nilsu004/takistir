import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCredentials,
  safeDestination,
  signedInDestination,
  mergeNotice,
  submitCredentials,
} from './model.js';

const login = { email: 'deniz@example.com', password: 'CustomerDemo!24' };
const register = {
  ...login,
  name: 'Deniz',
  confirmation: login.password,
  home: 'İstanbul, Kadıköy',
};

test('email and names are normalized, while the chosen password is preserved', () => {
  const result = validateCredentials({
    ...register,
    email: '  DENIZ@Example.COM  ',
    name: '  Deniz Yılmaz  ',
  });
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.body, {
    email: login.email,
    name: 'Deniz Yılmaz',
    password: login.password,
  });
  assert(!('confirmation' in result.body));
});

test('empty, malformed and oversized email addresses are rejected before submission', () => {
  for (const email of [
    '',
    '   ',
    'deniz',
    'a@b',
    'a b@example.com',
    `${'a'.repeat(250)}@a.com`,
    null,
  ])
    assert(validateCredentials({ ...login, email }).errors.email);
});

test('registration requires a nonblank name and matching passwords', () => {
  for (const name of ['', '  ', 'a'.repeat(161), null])
    assert(validateCredentials({ ...register, name }).errors.name);
  assert(
    validateCredentials({ ...register, confirmation: 'SomethingElse!24' })
      .errors.confirmation,
  );
  assert(
    validateCredentials({ ...register, confirmation: undefined }).errors
      .confirmation,
  );
});

test('registration enforces password boundaries without silently trimming the password', () => {
  for (const password of [
    'short',
    'a'.repeat(129),
    ' Password!24',
    'Password!24 ',
    null,
  ])
    assert(
      validateCredentials({ ...register, password, confirmation: password })
        .errors.password,
    );
  for (const password of ['a'.repeat(8), 'a'.repeat(128), 'Pass word!24'])
    assert.deepEqual(
      validateCredentials({ ...register, password, confirmation: password })
        .errors,
      {},
    );
});

test('sign-in accepts existing short passwords but rejects blank and oversized input', () => {
  assert.deepEqual(
    validateCredentials({ ...login, password: 'short' }).errors,
    {},
  );
  for (const password of ['', '   ', 'a'.repeat(129), null])
    assert(validateCredentials({ ...login, password }).errors.password);
});

test('internal customer return routes and catalogue queries are retained', () => {
  for (const path of [
    '/',
    '/cart',
    '/account',
    '/wishlist',
    '/catalog?q=pearl',
    '/product/TK-001',
    '/orders',
    '/orders/TK-1',
    '/invoice/TK-1',
    '/checkout/delivery',
    '/checkout/payment',
  ])
    assert.equal(safeDestination(path), path);
});

test('external destinations, staff routes, malformed paths and auth loops are rejected', () => {
  for (const path of [
    undefined,
    '',
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/cart\n',
    '/cart#x',
    '/login',
    '/register?next=/cart',
    '/product-manager',
    '/sales-manager',
    '/unknown',
    '/checkout/other',
  ])
    assert.equal(safeDestination(path), '/account');
});

test('staff and customer destinations respect roles and cart loading failure', () => {
  assert.equal(
    signedInDestination({ role: 'product-manager' }, '/checkout/delivery'),
    '/product-manager',
  );
  assert.equal(
    signedInDestination({ role: 'support-agent' }, '/cart'),
    '/account',
  );
  assert.equal(
    signedInDestination({ role: 'customer' }, '/checkout/delivery'),
    '/checkout/delivery',
  );
  assert.equal(
    signedInDestination({ role: 'customer' }, '/checkout/payment', 'Offline'),
    '/cart',
  );
  assert.equal(
    signedInDestination({ role: 'customer' }, '/orders', 'Offline'),
    '/orders',
  );
});

test('a normal merge notice identifies retained guest products', () => {
  assert.match(
    mergeNotice({ merged: 2, adjusted: [], skipped: [] }),
    /2 guest-cart products saved/,
  );
  assert.match(mergeNotice({ merged: 1 }), /1 guest-cart product saved/);
  assert.equal(mergeNotice(null), null);
  assert.equal(mergeNotice({ merged: 0, adjusted: [], skipped: [] }), null);
});

test('stock adjustments and cart-limit losses are explained accurately', () => {
  const message = mergeNotice(
    {
      merged: 1,
      adjusted: [{ id: 'TK-003', requested: 9, qty: 6 }],
      skipped: ['TK-002'],
    },
    [{ id: 'TK-003', name: 'Ring' }],
  );
  assert.match(message, /Ring: requested 9, kept 6/);
  assert.match(message, /Not added.*TK-002/);
  assert(!message.includes('undefined'));
});

test('invalid forms never call an authentication endpoint', async () => {
  let calls = 0;
  const result = await submitCredentials(
    { ...register, confirmation: 'wrong' },
    async () => {
      calls += 1;
    },
  );
  assert(result.fieldErrors.confirmation);
  assert.equal(calls, 0);
});

test('registration sends only accepted account fields and exposes merge feedback', async () => {
  const sent = [];
  const result = await submitCredentials(register, async (...args) => {
    sent.push(args);
    return {
      error: '',
      data: { cart: { merged: 1, adjusted: [], skipped: [] } },
      state: { user: { role: 'customer' }, products: [] },
    };
  });
  assert.equal(sent[0][0], '/auth/register');
  assert.equal(sent[0][1], 'POST');
  assert.deepEqual(Object.keys(sent[0][2]).sort(), [
    'email',
    'name',
    'password',
  ]);
  assert.deepEqual(sent[1], [
    '/profile',
    'PATCH',
    { name: 'Deniz', email: login.email, home: register.home },
  ]);
  assert.match(result.notice, /1 guest-cart product saved/);
});

test('registration requires a home address and trims it without sending it to the register endpoint', () => {
  for (const home of [undefined, '', ' ', null, 'a'.repeat(501)])
    assert(validateCredentials({ ...register, home }).errors.home);
  const result = validateCredentials({ ...register, home: '  İstanbul  ' });
  assert.deepEqual(result.errors, {});
  assert.equal(result.home, 'İstanbul');
  assert(!('home' in result.body));
});

test('address save failure is a partial success and returns the customer to their profile', async () => {
  const calls = [];
  const result = await submitCredentials(register, async (path) => {
    calls.push(path);
    if (path === '/profile') return { error: 'Offline' };
    return {
      error: '',
      data: null,
      state: { user: { role: 'customer' }, products: [] },
    };
  });
  assert.equal(result.error, '');
  assert.match(
    result.profileError,
    /account was created.*address was not saved/,
  );
  assert.deepEqual(calls, ['/auth/register', '/profile']);
  assert.equal(
    signedInDestination(
      result.state.user,
      '/checkout/delivery',
      '',
      result.profileError,
    ),
    '/account',
  );
});

test('a rejected address request never retries account creation or sends credentials to profile', async () => {
  const result = await submitCredentials(
    register,
    async (path, method, body) => {
      if (path === '/profile') {
        assert(!('password' in body));
        throw new Error('Connection lost');
      }
      return {
        error: '',
        data: null,
        state: { user: { role: 'customer' }, products: [] },
      };
    },
  );
  assert.equal(result.error, '');
  assert.match(result.profileError, /Connection lost/);
});

test('login server errors and unexpected network rejection remain actionable errors', async () => {
  const result = await submitCredentials(login, async () => ({
    error: 'Email or password is incorrect.',
  }));
  assert.match(result.error, /incorrect/);
  assert(!result.state);
  const disconnected = await submitCredentials(login, async () => {
    throw new Error('Cannot reach the API.');
  });
  assert.equal(disconnected.error, 'Cannot reach the API.');
});
