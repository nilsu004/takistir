# Product Manager integration

Start **both services** with `npm run dev` at the repository root. Open `http://127.0.0.1:5173/#/login` and expand **Local test accounts**. Product Manager login opens `#/product-manager`; customer login opens My account (or continues checkout). The management link is shown only to managers. Customer or guest navigation directly to the workspace is blocked; the API independently checks each role.

## Try the shared flow locally

1. In a normal browser window, sign in with **Use Product Manager demo**.
2. In an incognito window or another browser profile, open the same URL and choose **Use customer demo**. Ordinary tabs share the same login cookie.
3. Change a product name, warranty, distributor or stock in the panel. The customer catalog/detail page refreshes within three seconds or when focused. Add/remove an empty category and check the navigation/filter.
4. Create a product with all required fields. It appears as **Price pending** and is not purchasable. Existing sale prices are read-only; pricing and discounts remain Sales Manager responsibilities.
5. Open **Orders & deliveries**, select an order and advance Processing → In transit → Delivered. Confirm the same status in the customer's order history. Review delivery/customer/product IDs, quantities, paid totals, address and invoice.
6. In **Review moderation**, approve/reject a pending review. Star ratings appear immediately; only approved comments appear publicly. Rejecting a comment leaves its rating in the public average. Customer reviews require a delivered purchase verified by the API.
7. Complete customer mock checkout with sample card values. Card fields never leave the payment form. The API stores the order, snapshots prices, decreases stock and makes it visible to the manager. Cancel a Processing order to restore its reserved stock once.
8. Reload both windows or restart the API: manager changes and orders remain in the local SQLite database. Remove a product and confirm historical invoices still retain its original name and price.

## Architecture and boundaries

Manager screens and responsive styles live in `frontend/src/manager/`. Existing fonts, colors and common UI components are retained. `Store.jsx` is now an API client/cache, not a second source of inventory/order data. Validation and rating rules shared by frontend/backend live in `shared/`. `backend/src/service.js` enforces business rules; `store.js` provides the local transactional SQLite adapter; `app.js` handles HTTP/session/role boundaries.

This is a local integration, not production deployment or PostgreSQL integration. SQLite stores a JSON application snapshot and sessions. Known seeded credentials are restricted to local mode; startup refuses production mode. Cart/wishlist remain browser-local. Cross-session data refreshes through polling, not WebSockets. No Sales Manager, Support Agent, real payment, refund approval or invoice email/PDF service was added. Read-only invoice views and the existing browser print flow remain demo documents.

Star ratings publish immediately, matching course requirement 5. Comments require moderation. Seeded historical aggregate ratings remain part of the public average. Seed order addresses/tracking are fixtures, and their inventory was not reserved; cancelling a seed order does not invent stock.

## Validation

- `npm test`: HTTP tests cover session cookies, login/logout, role and ownership boundaries, protected request origins, CRUD/category guards, stock validation, protected pricing, server-priced/idempotent checkout, concurrent last-unit purchases, cancellation, delivery transitions, review eligibility/moderation and database reopening. Shared rule tests cover input validation and published rating calculations.
- `npm run check`: all tests, production frontend build and repository formatting.
- A temporary React test-renderer harness exercised login redirects, actual async manager forms, role gates, customer catalog/reviews/history, checkout and focus refresh against a real isolated local HTTP API. Its dependency was installed only under `/private/tmp`.
- Follow-up on 12 November 2026: isolated Chrome QA passed for catalog/search/filter persistence, stock refresh/quantity guards, customer review submission, manager approval/rejection and public comment visibility. Catalog/product/moderation layouts were checked at 320, 390, 768 and 1440 px, and screenshots inspected. See [current frontend handoff](docs/sprint-2-3-frontend.md) for scope and remaining team acceptance.

See `backend/README.md` for account credentials, routes, storage details and limits.
