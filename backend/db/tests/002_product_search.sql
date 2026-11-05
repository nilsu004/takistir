-- SCRUM-45: tests for product search
BEGIN;
-- Same search as search_products.sql
CREATE FUNCTION pg_temp.search_products(search_text TEXT)
RETURNS TABLE (name VARCHAR, price NUMERIC, stock_quantity INTEGER)
LANGUAGE sql AS $$
    SELECT p.name, p.price, p.stock_quantity
    FROM products p
    WHERE p.name ILIKE '%' || search_text || '%'
       OR p.description ILIKE '%' || search_text || '%'
    ORDER BY p.price ASC;
$$;

INSERT INTO categories (name) VALUES ('Test Category');

INSERT INTO products (category_id, name, model, serial_number, description,
                      stock_quantity, price, warranty_status, distributor)
SELECT c.id, v.name, v.model, v.serial, v.description, v.stock, v.price, '1 year', 'Test Distributor'
FROM categories c,
     (VALUES
        ('Zxqtest Gold Ring', 'T-01', 'TEST-0001', 'Plain ring', 5, 300.00),
        ('Plain Necklace', 'T-02', 'TEST-0002', 'Necklace with a zxqtest charm', 0, 100.00),
        ('Other Watch', 'T-03', 'TEST-0003', 'Nothing special', 3, 200.00)
     ) AS v(name, model, serial, description, stock, price)
WHERE c.name = 'Test Category';

DO $$
DECLARE
    n INTEGER;
    first_name TEXT;
BEGIN
    --finds a product by name
    SELECT count(*) INTO n FROM pg_temp.search_products('Zxqtest Gold');
    ASSERT n = 1, 'Test 1 failed: name search should find 1 product';

    --finds a product by description
    SELECT count(*) INTO n FROM pg_temp.search_products('zxqtest charm');
    ASSERT n = 1, 'Test 2 failed: description search should find 1 product';

    --search is not case-sensitive and checks both name and description
    SELECT count(*) INTO n FROM pg_temp.search_products('ZXQTEST');
    ASSERT n = 2, 'Test 3 failed: uppercase search should find 2 products';

    --out-of-stock products are still shown
    SELECT count(*) INTO n FROM pg_temp.search_products('zxqtest') WHERE stock_quantity = 0;
    ASSERT n = 1, 'Test 4 failed: out-of-stock product should be in results';

    --a word that matches nothing returns no products
    SELECT count(*) INTO n FROM pg_temp.search_products('nosuchproduct123');
    ASSERT n = 0, 'Test 5 failed: unknown word should return 0 products';

    --sorted by price, cheapest first
    SELECT s.name INTO first_name FROM pg_temp.search_products('zxqtest') s LIMIT 1;
    ASSERT first_name = 'Plain Necklace', 'Test 6 failed: cheapest product should be first';

    --both search indexes exist
    SELECT count(*) INTO n FROM pg_indexes
    WHERE tablename = 'products'
      AND indexname IN ('products_name_trgm_idx', 'products_description_trgm_idx');
    ASSERT n = 2, 'Test 7 failed: search indexes are missing';

    RAISE NOTICE 'All 7 search tests passed';
END $$;

ROLLBACK;