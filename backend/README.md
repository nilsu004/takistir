# Backend — local integration

The Express API now connects the storefront and Product Manager workspace. Run Node.js 24+ and `npm run dev` from the repository root. Vite proxies `/api` to `http://127.0.0.1:3001`.

## Local storage and accounts

The local adapter uses Node's built-in SQLite module. On first startup it creates `backend/data/local.sqlite` with the existing catalog, sample orders and two test accounts:

| Role            | Email                  | Password        |
| --------------- | ---------------------- | --------------- |
| Customer        | deniz@example.com      | CustomerDemo!24 |
| Product Manager | manager@takistir.local | ManagerDemo!24  |

Use **My account → Local test accounts** or enter these credentials. Use an incognito window or a different browser profile to run both roles simultaneously; ordinary tabs share cookies.

Changes persist across page reloads and API restarts. Set `LOCAL_DB_PATH` to use a different SQLite file; relative paths resolve from the backend process directory. The database, passwords and session data are ignored by Git. To get fresh fixtures without deleting anything, start with a new `LOCAL_DB_PATH`.

This adapter is for local testing. Startup refuses `NODE_ENV=production` because known test credentials are seeded. The PostgreSQL migration under `db/` is retained unchanged and is not connected by this adapter. SQLite stores a versioned JSON application snapshot plus a separate session table; it is not a migration of the team's relational PostgreSQL schema.

## API

All state-changing requests require JSON and `X-Takistir-Request: 1`. Same-origin browser requests go through Vite; no cross-origin CORS access is enabled. Local frontend origins on ports 5173 and 5174 are accepted. Sessions use random opaque HttpOnly/SameSite=Strict cookies, hashed tokens in SQLite, an eight-hour expiry and server-side logout invalidation. Passwords use salted scrypt hashes. The server assigns roles; self-registration can create only customers.

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

Mutations return `{ data, state }`; the state has a revision and is filtered by role/ownership. No password hashes, session tokens, other customers' orders or unapproved reviews are exposed to public clients. Catalog and order views refresh every three seconds and on window focus. A disconnected UI displays an API error instead of silently switching to independent demo data.

Stock checks, order creation, cancellation, category guards and moderation run inside `BEGIN IMMEDIATE` SQLite transactions. A checkout key prevents retrying the same purchase from decrementing stock twice. Prices come from the server; client price fields cannot change order totals. Product Manager cannot set price or discount fields. New products await Sales Manager pricing and cannot be purchased yet. Removal archives products, preserving purchase-time order/invoice names, images and paid prices.

## Checks and limits

`npm test` runs the HTTP integration and shared rule tests; `npm run check` also builds the frontend and checks formatting. Tests create isolated temporary databases and servers.

This change does not add Sales Manager or Support Agent backend workflows, real payments, delivery-provider calls, invoice PDF generation/email, password recovery, email verification, production account provisioning or the PostgreSQL adapter. Return requests are recorded for the existing customer screen; refund approval/processing is not implemented. Cart and wishlist remain browser-local. Their retention is not cross-device. Account tax IDs still use demo placeholders.

Both review comments and star ratings require approval, following the requested panel behavior; this differs from course requirement 5, which calls for immediate star publication. The original historical rating aggregates are seeded demo values.
