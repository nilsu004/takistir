SELECT p.id, p.name, p.description, p.price, p.stock_quantity, c.name AS category
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.name ILIKE '%' || $1 || '%'
   OR p.description ILIKE '%' || $1 || '%'
ORDER BY p.price ASC; --increase
