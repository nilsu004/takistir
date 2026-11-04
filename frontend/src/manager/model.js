export const orderStatuses = ['Processing', 'In transit', 'Delivered'];
export const initialCategories = [
  'Necklaces',
  'Earrings',
  'Rings',
  'Bracelets',
];
export const productImages = [
  'necklace-card.svg',
  'earrings-card.svg',
  'ring-card.svg',
];

export function validateProduct(product, products, categories, editingId) {
  const required = [
    'id',
    'name',
    'category',
    'model',
    'serial',
    'description',
    'warranty',
    'distributor',
    'material',
  ];
  if (
    required.some(
      (key) => typeof product[key] !== 'string' || !product[key].trim(),
    )
  )
    return 'Complete all required product fields.';
  if (!/^[A-Za-z0-9-]{1,40}$/.test(product.id))
    return 'Use up to 40 letters, numbers or hyphens for the product ID.';
  if (
    products.some(
      (p) =>
        p.id !== editingId && p.id.toLowerCase() === product.id.toLowerCase(),
    )
  )
    return 'This product ID is already in use, including removed products.';
  if (
    products.some(
      (p) =>
        p.id !== editingId &&
        p.serial.toLowerCase() === product.serial.toLowerCase(),
    )
  )
    return 'Serial numbers must be unique.';
  if (editingId && product.id !== editingId)
    return 'Product IDs cannot be changed.';
  if (!categories.includes(product.category))
    return 'Select an available category.';
  if (
    !Number.isSafeInteger(product.stock) ||
    product.stock < 0 ||
    product.stock > 1000000
  )
    return 'Stock must be a whole number between 0 and 1,000,000.';
  if (!productImages.includes(product.image))
    return 'Select a preview illustration.';
  if (
    required.some(
      (key) => product[key].length > (key === 'description' ? 2000 : 160),
    )
  )
    return 'A product field exceeds its maximum length.';
  return '';
}

export function canTransition(current, next) {
  return (
    orderStatuses.includes(current) &&
    orderStatuses.indexOf(next) === orderStatuses.indexOf(current) + 1
  );
}

export function publishedRating(product, reviews) {
  const approved = reviews.filter(
    (r) => r.productId === product.id && r.status === 'Approved',
  );
  const count = (product.ratingCount || 0) + approved.length;
  const sum =
    (product.rating || 0) * (product.ratingCount || 0) +
    approved.reduce((total, r) => total + r.rating, 0);
  return { count, rating: count ? (sum / count).toFixed(1) : 'No ratings yet' };
}
