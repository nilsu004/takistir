-- Run after migration in a disposable test database, never production.
-- Fixtures and temporary test helper are rolled back on success.
BEGIN;

CREATE FUNCTION pg_temp.expect_sqlstate(statement TEXT, expected TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    actual TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
        IF actual = expected THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'Expected SQLSTATE %, got % for %', expected, actual, statement;
    END;
    RAISE EXCEPTION 'Expected SQLSTATE %, but statement succeeded: %', expected, statement;
END;
$$;

INSERT INTO categories (name) VALUES ('SCRUM-42 test category');

INSERT INTO products (
    category_id, name, model, serial_number, description,
    price, warranty_status, distributor
)
VALUES (
    currval(pg_get_serial_sequence('categories', 'id')),
    'Test necklace', 'TEST-01', '000042', 'Constraint test fixture',
    349.90, '24 months', 'Test distributor'
);

DO $$
DECLARE
    item products%ROWTYPE;
    category INTEGER := currval(pg_get_serial_sequence('categories', 'id'));
    product INTEGER := currval(pg_get_serial_sequence('products', 'id'));
BEGIN
    SELECT * INTO STRICT item FROM products WHERE id = product;
    IF item.stock_quantity <> 0 OR item.cost IS NOT NULL OR item.serial_number <> '000042' THEN
        RAISE EXCEPTION 'Default stock, nullable cost or serial leading zeros failed';
    END IF;
    IF ROUND(COALESCE(item.cost, item.price * 0.50), 2) <> 174.95 THEN
        RAISE EXCEPTION 'NULL cost fallback failed';
    END IF;

    UPDATE products SET cost = 0 WHERE id = product;
    SELECT * INTO STRICT item FROM products WHERE id = product;
    IF COALESCE(item.cost, item.price * 0.50) <> 0 THEN
        RAISE EXCEPTION 'Explicit zero cost was replaced by fallback';
    END IF;
    UPDATE products SET cost = 100 WHERE id = product;
    SELECT * INTO STRICT item FROM products WHERE id = product;
    IF COALESCE(item.cost, item.price * 0.50) <> 100 THEN
        RAISE EXCEPTION 'Explicit cost was not preserved';
    END IF;

    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET stock_quantity = -1 WHERE id = %s', product), '23514');
    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET price = -0.01 WHERE id = %s', product), '23514');
    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET cost = -0.01 WHERE id = %s', product), '23514');
    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET price = ''NaN'' WHERE id = %s', product), '23514');
    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET cost = ''NaN'' WHERE id = %s', product), '23514');
    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET category_id = NULL WHERE id = %s', product), '23502');
    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET category_id = -1 WHERE id = %s', product), '23503');
    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET serial_number = NULL WHERE id = %s', product), '23502');
    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET serial_number = ''   '' WHERE id = %s', product), '23514');
    PERFORM pg_temp.expect_sqlstate(
        format('UPDATE products SET name = ''   '' WHERE id = %s', product), '23514');
    PERFORM pg_temp.expect_sqlstate('INSERT INTO categories (name) VALUES (''   '')', '23514');
    PERFORM pg_temp.expect_sqlstate(
        format('DELETE FROM categories WHERE id = %s', category), '23503');
    PERFORM pg_temp.expect_sqlstate(
        format('INSERT INTO products (category_id, name, model, serial_number, description,
                    price, warranty_status, distributor)
                SELECT category_id, name, model, serial_number, description,
                    price, warranty_status, distributor FROM products WHERE id = %s', product), '23505');

    -- Zero price/stock and NULL cost are valid; exact decimal arithmetic is retained.
    UPDATE products SET price = 0, stock_quantity = 0, cost = NULL WHERE id = product;
    UPDATE products SET price = 0.10 WHERE id = product;
    SELECT * INTO STRICT item FROM products WHERE id = product;
    IF item.price * 3 <> 0.30 THEN
        RAISE EXCEPTION 'Exact decimal arithmetic failed';
    END IF;

    -- A category may have several products.
    INSERT INTO products (category_id, name, model, serial_number, description,
        price, warranty_status, distributor)
    VALUES (category, 'Second product', 'TEST-02', '000043', '', 0, 'None', 'Test distributor');
    IF (SELECT count(*) FROM products WHERE category_id = category) <> 2 THEN
        RAISE EXCEPTION 'One-to-many category relationship failed';
    END IF;
    DELETE FROM products WHERE category_id = category;
    DELETE FROM categories WHERE id = category;
END;
$$;

ROLLBACK;
