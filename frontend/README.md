# Frontend — `frontend/`

This folder contains the React application that runs in the user's browser. Vite provides the development server and builds the frontend.

## Interactive preview

- Home and product details use the Figma design's colors, fonts and original local SVG assets.
- Catalog/search/sorting, cart, wishlist, demo login/registration, checkout, profile, orders, cancellation, item returns, invoice printing and demo chat can be explored.
- Cart and wishlist persist in localStorage. Session, stock, orders and reviews reset on refresh.
- This is a browser-only preview: no real authentication, payment, email, file upload, database or support agent connection. Manager screens are not implemented.

The Figma tool quota allowed detailed reads of Home and Product details only. Additional customer flows use the same visual language; they are not a pixel-exact conversion of every Figma screen. Read [the Turkish guide](../ONIZLEME.md) for an inspection walkthrough.

## Current integration

The customer storefront and Product Manager share the same API through `src/Store.jsx` and `src/api.js`. `src/manager/` contains management screens and responsive styles. `shared/` at the repository root contains catalog fixtures and shared validation/rating rules. Account roles come from the server session; the frontend does not assign them.

Run `npm run dev` at the repository root and open <http://127.0.0.1:5173>. Both frontend and backend must run. Vite proxies `/api` to port 3001. Backend connection errors are displayed rather than falling back to independent demo state. The client refreshes shared data every three seconds and on focus.

Use **My account → Local test accounts** to select a role. The manager is directed to the management workspace. Use an incognito window or separate browser profile to test another role simultaneously. Inventory, orders and moderation persist through the local backend; cart and wishlist remain in browser localStorage. Mock payment card fields are not sent to the server.

See [integration scenarios and limits](../PRODUCT_MANAGER_DEMO.md), [local API details](../backend/README.md) and the [main README](../README.md). Build with `npm run build` and run the complete checks with `npm run check` from the repository root.
