# SCRUM-50: API-backed shopping cart

## Scope

The existing React cart now uses the existing cart API. Backend code, database schema and migrations are unchanged. This covers the shopping-cart portions of course requirements 1, 3, 4 and 7: guests can add products, stock limits are respected, sign-in precedes checkout and the server retains the guest cart during login/registration. Cart additions do not reserve or decrease stock.

## Implementation

- `frontend/src/cart/Cart.jsx` and `cart.css` contain the cart screen and scoped responsive styles. `Storefront.jsx` re-exports the screen, so existing routes/imports keep working.
- `cart-client.js` reads `GET /api/cart`, updates quantities with `PUT /api/cart/items/:id`, removes items with `DELETE /api/cart/items/:id`, and clears with `DELETE /api/cart`. Only IDs and quantities are sent; prices, stock, availability and totals come from the API.
- Removed, unpriced and insufficient-stock lines remain visible. They do not count towards the API total. Customers must remove them or reduce quantities before checkout. A quantity above the new stock can be corrected with **Use available stock**.
- Cart writes are serialized by disabling controls and rejecting overlapping requests. Obsolete poll responses and previous-account responses cannot overwrite the current cart. A failed write is reconciled with a read, without automatically repeating the write.
- Initial loading, empty cart, retry, stale-data errors, write errors and success feedback are distinct. Failed writes do not optimistically change the cart.
- `Store.jsx` shares this cart with the header and checkout. Account changes immediately clear the previous cart view and reload the correct server cart. Staff accounts do not request or modify a cart.
- `Quantity` accepts an optional disabled prop. `Summary` labels unavailable lines correctly. Checkout has minimal loading/unavailability guards to preserve the existing flow.
- Cart data is no longer read from or written to localStorage. Old preview carts, including the automatically prefilled sample items, are not imported. Wishlist behavior is unchanged.

## Try it locally

Run `npm ci` if dependencies are missing, then `npm run dev`. Open <http://127.0.0.1:5173/#/cart>.

1. As a guest, start with an empty cart. Add an in-stock product from its detail page. Refresh the browser and confirm it remains.
2. Add the same product again. Check the header count, quantity and total. Increase/decrease the quantity, remove an item, and try **Clear cart**, including cancelling confirmation.
3. Sign in using the customer demo. Confirm the guest items are retained in the account cart. Sign out; the guest cart should be empty. Sign back in; the account cart should return.
4. In a separate browser profile, sign in as Product Manager and reduce a cart product's stock below its requested quantity. Refresh the customer cart. The line should remain with a warning, be excluded from the total, and block checkout. Reduce it to the available stock or remove it.
5. Repeat with zero stock or an archived product; the customer must still be able to remove the line. Out-of-stock product detail pages must not allow additions.
6. Stop the API. The page should report an error without silently replacing the cart or enabling checkout from stale data. Restart it and use **Retry**.
7. At a narrow mobile width, check product names, quantity controls, removal, warnings and the summary. Check keyboard navigation and disabled controls while saving.

## Automated checks

`node --test frontend/src/cart/cart-client.test.js` covers server-owned values, writes, invalid quantities, stock rejection, lost responses, overlapping requests, stale polls, account changes, staff restrictions, retry and React effect cleanup. These tests also run under `npm test` and `npm run check`.

Browser verification used the real API with a separate temporary PostgreSQL cluster, without using `backend/data/postgres` or the team's configured database. Safari checks covered guest addition, quantity/total/header updates, browser refresh persistence, login retaining guest items, stock reduction through the manager API, unavailable-line warnings and checkout blocking, correction to available stock, clear confirmation/cancellation, successful clearing and API-offline error/retry feedback. The cart layout was visually inspected at normal and increased browser zoom for narrow layouts; this is not a native mobile-device test.

## Backend dependency and checkout boundary

The existing `POST /api/orders` endpoint still accepts item IDs/quantities and does not consume the database cart (SCRUM-55). To preserve the working checkout, the frontend clears the cart only after confirmed order creation and reports a clear failure without hiding the successful order. Atomic checkout-and-cart clearing remains backend work: closing the browser between these requests or concurrent changes in another tab are not an atomic operation. Full checkout/payment completion is tracked under SCRUM-56/59, rather than claimed complete by SCRUM-50.

## Coordination with Doğa

Shared-file changes are limited to the cart connection in `Store.jsx`, moving/re-exporting `Cart` and correcting the privacy text in `Storefront.jsx`, the optional `Quantity.disabled` prop and unavailable summary labels in `components.jsx`, checkout guards, and the test script in `package.json`. Review these sections when combining catalogue/review work. The new `cart/` files are owned by SCRUM-50; no Product Manager or backend implementation is rewritten.
