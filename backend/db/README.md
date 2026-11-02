# Product and category database (SCRUM-42)

The migration targets **PostgreSQL 17**, matching the Docker Compose configuration on
`SCRUM-39-database-setup`. That setup is not yet on `main`; this change does not
merge it or add a backend database driver. SQL files can be applied with `psql` or
through the database container after that setup branch is integrated.

## Apply

From the repository root, against an empty local development database:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/migrations/001_create_categories_and_products.sql
```

`DATABASE_URL` must be exported in the shell. The backend's `.env` file is not
automatically read by `psql`. Use the connection settings from the database setup.
Apply the file once. It runs in a transaction and deliberately fails if the tables
already exist rather than silently accepting a different schema. There is no
migration history runner yet; future schema changes need new numbered migrations.

With Ceylin's Compose setup available and the `db` service running, the equivalent is:

```sh
docker compose exec -T db psql -U takistir -d takistir -v ON_ERROR_STOP=1 < backend/db/migrations/001_create_categories_and_products.sql
```

## Seed data

Mahmut owns `migrations/`; Ceylin owns `seeds/` (SCRUM-39). Create tables first,
then seed categories before products. Insert categories with `RETURNING id` and
use those IDs for products. Omit identity IDs when possible. Explicit seed IDs do
not advance PostgreSQL identity sequences and require separate sequence handling.

Use exactly these column names:

```text
categories(id, name)
products(id, category_id, name, model, serial_number, description,
         stock_quantity, price, cost, warranty_status, distributor)
```

The seed branch currently contains an empty `001_products_seed.sql`; this change
does not invent or overwrite Ceylin's data. See the data dictionary and example
seed contract in [the schema document](../../docs/product-category-schema.md).

## Verify

Use a disposable test database. Apply the migration there, then run:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/tests/001_product_category_constraints.sql
```

For the Compose database, replace the migration path in the Compose command above
with `backend/db/tests/001_product_category_constraints.sql`.

The test rejects duplicate serial numbers, invalid categories, missing required
values, blank names/serials, negative stock/prices/costs and numeric NaN values.
It also verifies zero stock/price, default stock, exact decimals, nullable/zero/
explicit cost, leading zeros in serial numbers, category deletion protection and
multiple products per category. Test rows are rolled back; identity sequences may
still advance, so do not run this on production data.

## Cost reporting

`cost` has no default value. For a current catalogue preview:

```sql
SELECT id, price, cost,
       ROUND(COALESCE(cost, price * 0.50), 2) AS effective_cost
FROM products;
```

Financial reports must use the relevant sale-time price when applying the 50%
fallback, rather than a later catalogue price. Order price/cost snapshots belong
to the order schema, outside SCRUM-42. An explicit zero cost stays zero.
