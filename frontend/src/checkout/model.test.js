import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAddress, cartQuote, sameQuote } from './model.js';

const address = {
  name: 'Deniz',
  street: 'Test Sokak 1',
  city: 'İstanbul',
  postcode: '34000',
};
test('delivery fields are trimmed and unrelated payment fields are never retained', () => {
  const result = validateAddress({
    ...address,
    name: ' Deniz ',
    cardnumber: '4242424242424242',
    securitycode: '123',
  });
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.address, address);
});
test('blank, malformed and oversized delivery fields are rejected', () => {
  for (const [key, max] of [
    ['name', 160],
    ['street', 300],
    ['city', 160],
    ['postcode', 20],
  ])
    for (const value of ['', ' ', null, 'a'.repeat(max + 1)])
      assert(validateAddress({ ...address, [key]: value }).errors[key]);
});
test('the complete address fits the database delivery-address boundary', () => {
  const result = validateAddress({
    name: 'a'.repeat(160),
    street: 'a'.repeat(300),
    city: 'a'.repeat(160),
    postcode: '12345',
  });
  assert.match(result.errors.street, /600/);
});
test('reviewed quotes ignore display order but detect quantity, price, availability and total changes', () => {
  const a = { id: 'A', qty: 1, price: 10, available: true };
  const b = { id: 'B', qty: 2, price: 20, available: true };
  const quote = cartQuote({ items: [a, b], total: 50 });
  assert(sameQuote(quote, cartQuote({ items: [b, a], total: 50 })));
  for (const change of [{ qty: 2 }, { price: 11 }, { available: false }])
    assert(
      !sameQuote(
        quote,
        cartQuote({ items: [{ ...a, ...change }, b], total: 50 }),
      ),
    );
  assert(!sameQuote(quote, cartQuote({ items: [a, b], total: 51 })));
});
