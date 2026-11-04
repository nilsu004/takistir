export { products, initialOrders } from '../../shared/seed.js';
export const money = (amount) =>
  amount === null
    ? 'Price pending'
    : `${new Intl.NumberFormat('en-GB').format(amount)} TRY`;
export { returnEligible } from '../../shared/order-rules.js';

export const displayDate = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

export function navigate(path) {
  window.location.hash = path;
}
