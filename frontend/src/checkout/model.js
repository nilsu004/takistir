export function validateAddress(input = {}) {
  const address = {};
  const errors = {};
  for (const [key, label, max] of [
    ['name', 'Full name', 160],
    ['street', 'Street address', 300],
    ['city', 'City', 160],
    ['postcode', 'Postcode', 20],
  ]) {
    address[key] = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!address[key] || address[key].length > max)
      errors[key] = `${label} is required (maximum ${max} characters).`;
  }
  if (
    `${address.name} · ${address.street}, ${address.city} ${address.postcode}`
      .length > 600
  )
    errors.street =
      'The complete delivery address must not exceed 600 characters.';
  return { address, errors };
}

export function cartQuote(cart) {
  return {
    items: cart.items
      .map(({ id, qty, price, available }) => ({ id, qty, price, available }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    total: cart.total,
  };
}
export function sameQuote(first, second) {
  return (
    !!first && !!second && JSON.stringify(first) === JSON.stringify(second)
  );
}
