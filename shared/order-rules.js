// Orders currently store calendar dates rather than purchase timestamps.
// Use the same UTC date boundary as checkout on both client and server.
export function returnEligible(order, now = new Date()) {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const purchased = Date.parse(`${order.date}T00:00:00Z`);
  const days = (today - purchased) / 86400000;
  return order.status === 'Delivered' && days >= 0 && days <= 30;
}
