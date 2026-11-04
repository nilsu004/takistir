# Product Manager demo

Open `http://127.0.0.1:5174/#/product-manager` while the frontend is running on port 5174. The storefront footer also includes a **Product Manager demo** link.

```sh
npm run dev --workspace frontend -- --port 5174
```

The panel reuses the storefront's fonts, colors, Button, Field, Notice and EmptyState components. Manager screens and responsive styles live in `frontend/src/manager/`; shared actions live in `frontend/src/Store.jsx`.

## Demo flows

- Products: add, edit, remove, search and update stock. Required fields include ID, name, model, serial, description, category, stock, warranty and distributor. IDs are immutable and cannot be reused after removal. Serial numbers are unique. Removal asks for confirmation, removes the product from customer browsing/cart/wishlist, and retains historical order/invoice snapshots.
- Categories: add a category and see it in the storefront navigation and filters. Remove an empty category; populated categories require moving/removing products first.
- Prices: existing sale prices are read-only and preserved during editing. New products show **Price pending**, remain visible, and cannot be purchased until Sales Manager pricing is connected. The manager actions ignore supplied price fields. No discounts or Sales Manager screens were added.
- Orders & deliveries: inspect order and delivery IDs, customer ID, address, product IDs, quantities, paid unit/line totals, tracking reference, completion and a read-only demo invoice. Advance Processing → In transit → Delivered. Delivered and Cancelled are terminal. Customer order history uses the same state. Purchase-time names, illustrations and paid prices remain available after catalog edits/removal.
- Reviews: a seeded pending review for Aurea Hoop Earrings can be approved or rejected immediately. Alternatively, use the customer demo account, open a delivered purchase and submit a review. Approvals publish both comment and stars; rejections publish neither. The customer product page reflects moderation without reloading.

## Limits and requirement interpretation

This is a browser-only, single-session demo. Products, categories, stock, orders and moderation reset on reload. Only the pre-existing cart and wishlist persist in localStorage. Changes propagate while navigating within the same app instance; other tabs/devices are not synchronized.

The backend currently exposes only a health endpoint. No real role authentication, authorization, database persistence, concurrent inventory transactions, delivery integration, image uploads, invoice generation/email or payment processing is implemented here. The panel is openly labeled a demo and uses the same single customer (`CU-001`) as the existing customer flows. Delivery addresses and tracking references are fixtures; new orders use the entered checkout address. Product illustration choices reuse local assets.

`docs/requirements.md` requirement 5 calls for immediate star publication and moderated comments. This implementation follows the explicit request for this change: **both stars and comments require approval**. Existing aggregate seed ratings are treated as previously approved demo history. Sales Manager, Support Agent and unrelated customer feature gaps remain outside this change.

## Verification

```sh
node --test frontend/src/manager/model.test.js
npm run check
```

The model tests cover required product fields, stock boundaries, category validity, archived ID/serial uniqueness, order transitions and exclusion of pending/rejected ratings. A temporary React state integration check also exercised every manager section, product/category mutations, read-only pricing, checkout after stock changes, review eligibility/moderation, customer publication and order/invoice snapshots after removal. It installed its test renderer only under `/private/tmp`; no project dependency was added.

Responsive CSS supports a single-column editor and horizontally scrollable data tables on narrow screens. No visual browser QA was available through the connected browser tool in this session.
