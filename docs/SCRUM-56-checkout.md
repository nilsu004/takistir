# SCRUM-56: checkout connected to the API cart

## Implemented frontend behavior

- Checkout uses the same server-owned cart lines, availability and total as the cart page. The delivery form starts from the saved checkout address or the customer's profile address. Required fields are trimmed and validated against the API limits, including the 600-character complete delivery-address limit.
- Only recipient, street, city and postcode are sent as delivery data. The former phone input was not persisted by the API and is no longer required/collected in checkout. Card fields remain an explicitly labeled demo and are neither sent to the API nor stored in application/browser state.
- The payment screen captures the reviewed cart summary. Checkout reloads the server cart immediately before submitting; changed quantities, prices, availability or totals block submission until the customer reviews the updated cart/summary. Unavailable products stay visible; the address is preserved through errors.
- Order errors appear inline. Request controls are disabled and synchronous guards prevent duplicate clicks. Order creation uses a server idempotency key.
- If an order response is lost or a server error leaves its outcome unknown, checkout offers confirmation recovery with the same captured items/address/key, even if stock is now exhausted. It does not silently start a second order or replay a request automatically. Cart edits are blocked until this attempt is resolved.
- After a confirmed order, checkout reloads the cart and removes purchased quantities only. Unrelated added products remain. Cleanup targets are recorded once per attempt, so a partial-cleanup retry does not subtract the same purchased quantities twice.
- If cleanup fails, the confirmed order remains a success. The confirmation page shows the confirmed server total, the cleanup error and a cleanup-only retry button. A new payment is not submitted to fix a cart error.
- Account changes discard the old account's checkout state and stale responses cannot clean another account's cart. Address and recovery state are in memory only.

## Files and coordination

`frontend/src/checkout/` contains the checkout screen, scoped styles, address/quote rules, checkout controller and tests. `Checkout.jsx` re-exports the screen and retains/enhances the confirmation screen. `Store.jsx` connects the controller and locks conflicting writes; `Cart.jsx` exposes recovery links and disables cart changes during recovery. `api.js` preserves HTTP status on errors to distinguish a rejected order from an unknown outcome. Cart refresh now returns its result to support final validation.

The store context moved to `store-context.js` so provider edits during development do not replace its identity and break already-mounted consumers. Existing `useStore` imports remain valid through re-export.

These are shared integration points with Doğa's frontend work. No backend, database or shared business-rule source is modified. This task builds on the SCRUM-50 cart and SCRUM-53 authentication flows.

## Try it locally

Run `npm run dev`, use the customer demo account, add an in-stock product, and continue to checkout.

1. Check that recipient/profile address are prefilled. Try blank fields and overlong addresses. Fill city/postcode and continue to payment; the summary and address must match the saved delivery data.
2. Change a product's stock from a separate Product Manager browser profile. Checkout should show unavailable quantities and link back to the cart, retaining the delivery address.
3. Change a price before final submission (the automated test changes it in an isolated test database). Checkout must reload the cart, show the new total, and require review before placing the order.
4. Enter sample card details, place a demo order and verify the confirmation total, order history, stock decrease and cleared purchased lines. Refresh the cart page to confirm the API cart was actually updated.
5. Use **Preview payment error** to show the existing demo failure state without creating an order. Normal API failures also have inline error feedback.
6. Check delivery/payment and recovery layouts at narrow widths and use the keyboard to reach inputs and actions.

## Automated verification

`npm run check` runs all existing tests plus checkout tests, builds the frontend and checks formatting. Checkout cases cover address validation, reviewed quotes, unavailable stock, rejected/unknown outcomes, duplicate clicks, lost-success recovery, partial cleanup, unrelated additions, account changes and post-preflight price races. Integration tests run production frontend clients against the real API using fresh temporary PostgreSQL databases; they verify purchase-time prices, stock, address, cart cleanup and one order per retry key.

## Remaining backend boundaries (SCRUM-55)

Manual verification used Safari with a separate temporary PostgreSQL cluster. Delivery-field errors, profile-address prefill and the payment summary were checked. Changing the customer cart quantity through a second API session triggered summary review before an order could be submitted. After review, the browser confirmed the order with the new 2,500 TRY total and the API cart/header count became empty. The delivery form was visually inspected at increased zoom for a narrow layout; a native mobile-device test was not performed.

- The existing `POST /api/orders` still accepts item IDs/quantities and does not consume the database cart. Order creation, stock decrease and paid-line cleanup need to be a single server transaction. Frontend cleanup cannot make cross-tab changes atomic, especially simultaneous changes to the same product's quantity.
- The API does not accept a reviewed-price/version token. A price can change between final refresh and order creation. Checkout reports any different confirmed total rather than claiming the race was prevented. Production-style price-consent enforcement needs a server quote/version check returning a conflict before creation.
- Retry keys and cleanup targets survive route navigation in the current app session, but not a full reload/browser close. Durable checkout recovery needs an authenticated server endpoint to look up an attempt by key (and/or server-side cart consumption). After an unknown outcome, check order history before beginning a new checkout after reloading.
- This remains mock payment. No real bank charge, invoice email or payment-provider verification is implemented here.
