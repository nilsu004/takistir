# Backend

The Express API connects the storefront and Product Manager workspace to **PostgreSQL 17**. Run Node.js 24+ and `npm run dev` from the repository root. Vite proxies `/api` to `http://127.0.0.1:3001`.

## Database

The API always uses PostgreSQL. It picks the server like this:

| Situation                 | Database used                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` is set     | That server, for example the team Docker database: `postgres://takistir:takistir@127.0.0.1:5432/takistir`                       |
| `DATABASE_URL` is not set | A private PostgreSQL 17 started by the `embedded-postgres` dev dependency, stored in `backend/data/postgres` (no Docker needed) |
| `NODE_ENV=production`     | `DATABASE_URL` is required; demo accounts are never created                                                                     |

Set `DATABASE_URL` in `backend/.env` (see `.env.example`) or the shell. `LOCAL_PG_DIR` changes the embedded data folder. To start again from demo data, stop the API and delete `backend/data/postgres` (or empty the Docker database). The data folder is ignored by Git.

On startup the API:

1. Applies every `db/migrations/NNN_*.sql` file that is not yet recorded in `schema_migrations`, in file-name order. A database where `001` was already applied by hand with `psql` is detected and adopted.
2. Outside production, loads the demo catalogue, orders and test accounts into an empty database (`src/seed.js`).

| Role            | Email                  | Password        |
| --------------- | ---------------------- | --------------- |
| Customer        | deniz@example.com      | CustomerDemo!24 |
| Product Manager | manager@takistir.local | ManagerDemo!24  |

Use **My account → Local test accounts** or enter these credentials. Use an incognito window or a different browser profile to run both roles simultaneously; ordinary tabs share cookies.

### Schema

`001` (Mahmut) creates `categories` and `products` and is unchanged. `003` adds the store fields the API needs: a public product `code` (such as `TK-001`; the integer `id` stays the internal key), image, material, collection, popularity, imported rating, an `archived` flag, case-insensitive unique category names, and a nullable `price` because sales managers set prices (requirement 11). Rows inserted without these columns get defaults, so plain catalogue seeds keep working. `004` adds `users`, `sessions`, `orders`, `order_items`, `return_requests`, `return_request_items` and `reviews`. Order items copy the product name, image and paid unit price at purchase time. Number `002` is left for the search-index migration on `SCRUM-45-search-queries`.

Deleting a product or category archives it, because past orders still reference them. Re-adding an archived category name restores it.

## API

All state-changing requests require JSON and `X-Takistir-Request: 1`. Same-origin browser requests go through Vite; no cross-origin CORS access is enabled. Local frontend origins on ports 5173 and 5174 are accepted. Sessions use random opaque HttpOnly/SameSite=Strict cookies, SHA-256 token hashes in the `sessions` table, an eight-hour expiry and server-side logout invalidation. Passwords use salted scrypt hashes. The server assigns roles; self-registration can create only customers.

| Method       | Endpoint                                                    | Access                                                       |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------------ |
| GET          | `/api/health`                                               | Public                                                       |
| GET          | `/api/state`                                                | Public catalog; private fields scoped to the current session |
| POST         | `/api/auth/login`, `/api/auth/register`, `/api/auth/logout` | Session operations                                           |
| PATCH        | `/api/profile`                                              | Signed-in account; name/email/address only                   |
| POST         | `/api/manager/products`                                     | Product Manager                                              |
| PUT / DELETE | `/api/manager/products/:id`                                 | Product Manager                                              |
| PATCH        | `/api/manager/products/:id/stock`                           | Product Manager                                              |
| POST         | `/api/manager/categories`                                   | Product Manager                                              |
| DELETE       | `/api/manager/categories/:name`                             | Product Manager                                              |
| PATCH        | `/api/manager/orders/:id/status`                            | Product Manager                                              |
| PATCH        | `/api/manager/reviews/:id`                                  | Product Manager                                              |
| POST         | `/api/orders`                                               | Customer; stock-checked mock checkout                        |
| POST         | `/api/orders/:id/cancel`, `/api/orders/:id/returns`         | Owning customer                                              |
| POST         | `/api/reviews`                                              | Customer with a delivered purchase                           |
| GET          | `/api/orders/:id/invoice`                                   | Owning customer or Product Manager                           |
| GET          | `/api/cart`                                                 | Guest (cookie) or customer; `{ items, total }`               |
| PUT          | `/api/cart/items/:id`                                       | Guest or customer; body `{ qty }`; adds or sets quantity     |
| DELETE       | `/api/cart/items/:id`, `/api/cart`                          | Guest or customer; removes one product / empties the cart    |

Mutations return `{ data, state }`; the state has a revision and is filtered by role/ownership. No password hashes, session tokens, other customers' orders or unapproved reviews are exposed to public clients. Catalog and order views refresh every three seconds and on window focus. A disconnected UI displays an API error instead of silently switching to independent demo data.

Every change runs in one PostgreSQL transaction (`src/db.js`, `tx`); if any step fails, nothing is saved. Checkout locks the purchased product rows with `SELECT … FOR UPDATE` in id order, so competing buyers cannot oversell and two carts with the same items in a different order cannot deadlock. A `CHECK` constraint also keeps stock non-negative. A checkout key prevents retrying the same purchase from decrementing stock twice. Prices come from the server; client price fields cannot change order totals. Product Manager cannot set price or discount fields. New products await Sales Manager pricing and cannot be purchased yet. Removal archives products, preserving purchase-time order/invoice names, images and paid prices.

## Cart (SCRUM-49)

Guests and signed-in customers each have one cart; staff accounts have none (403). Every cart endpoint returns:

```json
{
  "items": [
    {
      "id": "TK-001",
      "name": "Luna Pearl Necklace",
      "image": "necklace-card.svg",
      "price": 1250,
      "qty": 2,
      "stock": 12,
      "available": true
    }
  ],
  "total": 2500
}
```

- Prices, stock and the total come from the database. A price sent by the client is ignored. The total counts only `available` items and is calculated in cents.
- `PUT` checks the product: unknown or removed → 404; not priced yet, out of stock or quantity above stock → 409; quantity not a whole number ≥ 1 → 400. At most 100 different products per cart.
- The cart does not reserve stock; checkout checks stock again. An item that sells out, is removed or loses its price after being added stays in the cart with `available: false`.
- Guests are identified by the `takistir_cart` cookie (random token, HttpOnly, SameSite=Strict, stored only as a SHA-256 hash). It is created on the first `PUT` only; reading the cart sets no cookie. Guest carts expire 30 days after the last change and are deleted when new guest carts are created.
- Customer carts belong to the account, so they follow the customer across sessions and devices.
- **Signing in or registering keeps the guest cart (SCRUM-52).** The guest cart from that browser is moved into the account cart and the guest cookie is removed. A product in both carts gets the sum of the quantities, capped at the current stock when it can be bought. Sold-out, removed or unpriced products are moved too and shown with `available: false`, so nothing is silently lost. The login/register response reports this in `data.cart`, for example `{ "merged": 2, "adjusted": [{ "id": "TK-003", "requested": 9, "qty": 6 }], "skipped": [] }` (`skipped`: products over the 100-line limit); `data` is `null` when there was no guest cart. Failed sign-ins and staff accounts leave the guest cart untouched. After signing out, the browser starts with an empty guest cart.
- Tables: `carts` (exactly one of `customer_id` / `guest_token_hash`) and `cart_items` (one row per product, quantity > 0) in `db/migrations/005_create_carts.sql`, following the SCRUM-48 schema agreed with Mahmut.

## Checks and limits

`npm test` runs the HTTP integration, PostgreSQL and shared rule tests; `npm run check` also builds the frontend and checks formatting. Each test gets its own new database on a throwaway embedded PostgreSQL server. Set `TEST_DATABASE_URL` (for example `postgres://takistir:takistir@127.0.0.1:5432/postgres`) to use another server instead; test databases are created and dropped there, so never point it at real data.

This backend does not yet add Sales Manager or Support Agent backend workflows, real payments, delivery-provider calls, invoice PDF generation/email, password recovery, email verification, production account provisioning, or checkout from the server cart (SCRUM-55). The frontend still keeps its own cart until the cart page uses this API (SCRUM-50). Return requests are recorded for the existing customer screen; refund approval/processing is not implemented. The wishlist remains browser-local. Account tax IDs still use demo placeholders.

Both review comments and star ratings require approval, following the requested panel behavior; this differs from course requirement 5, which calls for immediate star publication. The original historical rating aggregates are seeded demo values.
