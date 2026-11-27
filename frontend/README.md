# Frontend — `frontend/`

This folder contains the React application that runs in the user's browser. Vite provides the development server and builds the frontend.

## Interactive preview

- Home and product details use the Figma design's colors, fonts and original local SVG assets.
- Catalog/search/sorting, cart, wishlist, demo login/registration, checkout, profile, orders, cancellation, item returns, invoice printing and demo chat can be explored.
- Guest and customer carts and signed-in customer wishlists are stored by the API. Guest wishlists persist in localStorage. Accounts, stock, orders and reviews persist through the PostgreSQL API.
- The local API provides session authentication, role checks and database persistence. Payment and chat are demos; email, file uploads and a real support agent are not connected. Product Manager screens are implemented.

The Figma tool quota allowed detailed reads of Home and Product details only. Additional customer flows use the same visual language; they are not a pixel-exact conversion of every Figma screen. Read [the Turkish guide](../ONIZLEME.md) for an inspection walkthrough.

## Current integration

The customer storefront and Product Manager share the same API through `src/Store.jsx` and `src/api.js`. `src/manager/` contains management screens and responsive styles. `shared/` at the repository root contains catalog fixtures and shared validation/rating rules. Account roles come from the server session; the frontend does not assign them.

Run `npm run dev` at the repository root and open <http://127.0.0.1:5173>. Both frontend and backend must run. Vite proxies `/api` to port 3001. Backend connection errors are displayed rather than falling back to independent demo state. The client refreshes shared data every three seconds and on focus.

Use **My account → Local test accounts** to select a role. Managers are directed to their respective workspaces. Use an incognito window or separate browser profile to test another role simultaneously. Guest carts use an HttpOnly cookie. Customer carts and wishlists belong to the account, and discount notifications are stored by the API. Mock payment card fields are not sent to the server.

The cart supports API-backed additions, quantity changes, removal and clearing, server-calculated totals, loading/retry states and unavailable items. See [SCRUM-50 verification and limits](../docs/SCRUM-50-cart.md). Old preview-only localStorage carts are not imported into the server cart.

Login and registration include field validation, password confirmation/visibility, guest-cart merge feedback and safe return navigation. See [SCRUM-53 verification and backend boundaries](../docs/SCRUM-53-auth.md), including the remaining tax-ID registration API requirement.

Checkout validates the delivery address, refreshes/reviews the API cart before ordering, prevents overlapping submissions and supports safe order-confirmation/cart-cleanup retries. See [SCRUM-56 verification and backend boundaries](../docs/SCRUM-56-checkout.md).

See [integration scenarios and limits](../PRODUCT_MANAGER_DEMO.md), [local API details](../backend/README.md) and the [main README](../README.md). Build with `npm run build` and run the complete checks with `npm run check` from the repository root.

Sales Manager: `#/sales-manager` provides pricing/discounts, date-filtered invoices, revenue/profit charts and receipt-gated demo refund approval. Customer notifications: `#/notifications`. See [accounting and validation](../docs/sales-manager.md).
