# Sprint 2–3 frontend — Doğa

## Scope and ownership

Doğa: SCRUM-44, 47, 68, 71, 116, 74; verify 41/134. Nilsu: SCRUM-50, 53, 56, 59, 62, 65 (cart, accounts, checkout/payment, invoices, orders/delivery).

Existing screens are extended in place. `Storefront.jsx` contains both catalog/review pages and Nilsu's Cart: coordinate by exported component. `Store.jsx` belongs to the shared integration boundary; this change only updates the review success message there. Cart, authentication and checkout logic are untouched. `App.jsx` stops remounting the catalog on filter changes so keyboard focus survives. `components.jsx` and `styles.css` are shared, so changes need Nilsu's review. No Jira status is changed automatically.

## Completed code changes

- Catalog: name/description search trims whitespace; category, availability and sort live in the URL, survive reload/back/forward and combine with the search query. Clear filters returns to the full catalog. Category links encode special characters.
- Price sorting: products with no price remain discoverable and sort last in both directions. Zero is a valid price. Ties use product IDs for stable ordering. Popularity currently uses the API's numeric `popularity` score, descending; it is not a sales counter.
- Product details: price-pending and sold-out products cannot be added to cart; a stock refresh clamps the displayed and submitted quantity. The rating link reports the actual average/count instead of displaying five filled stars for every product.
- Reviews: only customers with a delivered purchase can open/submit the form. API eligibility checks remain authoritative. Submission errors appear within the form and shared buttons disable during requests. Stars publish immediately; pending/rejected comment text stays private. Comment approval/rejection leaves the rating aggregate unchanged.
- Moderation: existing Product Manager page retains status filters and permission checks; heading, action labels and explanations now describe comment moderation. Errors stay visible above the list.
- Responsive layout: account links and product actions wrap; long product details/comments wrap; review tables fit narrow widths. The existing design assets/fonts are retained.

## API handoff / remaining backend work

1. PostgreSQL integration is now in `main` and has been merged into this branch. Public rating aggregates are computed from all PostgreSQL review rows while comment queries retain role/ownership filtering. No schema change is needed. The earlier SQLite validation below records the pre-merge implementation; post-merge validation is recorded separately.
2. Public ratings: `/api/state` products include `publishedRating: { count, rating }`; `rating` is a one-decimal string or `No ratings yet`. Compute it server-side using all submitted ratings plus historical aggregates. Do not expose pending/rejected comments or customer IDs publicly. The frontend prefers this aggregate over its visible comment subset.
3. Popularity: agree with backend/product owners on the production metric. Existing numeric fixture scores support demo sorting; no live sales metric is claimed.
4. Nilsu's related dependencies: actual invoice PDF generation/email, production pricing and account services remain separate backend work. The local mock checkout and browser invoice already exist.
5. Repeated reviews by the same purchaser are currently allowed by the existing API. Agree on one-per-product/edit rules before adding a uniqueness constraint; this change does not invent one.

## Demo / acceptance

1. Guest: search by description; combine category/stock/sort, reload and use browser Back. Find a sold-out item and verify Add to cart is disabled. Visit an unknown product and a search with zero results.
2. Customer: sign in with the local test account, open TK-002 (delivered fixture), submit a rating/comment. The average updates immediately, while the comment is not public.
3. Product Manager in a separate browser session: open Review moderation. Approve one comment and reject another. Check that only the approved text appears publicly and neither action changes the rating count/average.
4. Manager: change stock while a customer product page is open; allow up to three seconds for refresh and verify quantity/purchase controls. Verify guest/customer direct access to management is blocked.
5. Check 320, 390, 768 and 1440 px layouts: header, filters, cards, product actions, long comments, moderation and focus states. Review against the linked Figma reference with Nilsu; prototype handoff/review is still a team task for SCRUM-116.

## Validation — 12 November 2026

- Node 24: 18 API/shared-rule tests pass, including rating privacy/visibility, unchanged averages after rejection, catalog null-price ordering, combined filters and sold-out search.
- Vite production build passes.
- Isolated Chrome run with an in-memory database: guest search/filter/reload/back/forward, keyboard focus after sorting, sold-out purchase guard, live stock refresh and quantity clamping, customer review submission, manager approval/rejection/status filters, public approved text, missing product and empty search all pass. No page errors.
- Catalog, product and moderation pages checked for document overflow at 320, 390, 768 and 1440 px; no horizontal overflow. Desktop/mobile screenshots inspected, with narrow review rows improved after inspection. This checks the implemented layout, not pixel-perfect Figma parity or a full accessibility audit.
- Screenshot artifacts from the isolated run are under `/private/tmp/takistir-{catalog,product,manager}-{width}.png`; test data does not touch the working local database.

## Validation after merging current main

- `npm run check` passes on native embedded PostgreSQL: 69 tests, production build and repository formatting.
- Repeated the isolated Chrome catalog/review flow against a fresh PostgreSQL database: URL filters/reload/back/forward and focus, sold-out guard, live stock clamping, review submission, approve/reject/status filters, missing/empty states and public comment publication all pass. No page errors or document overflow at 320/390/768/1440 px.
- PostgreSQL migration/cart changes from `main` are preserved. This branch adds no migration and does not change the server cart/auth/checkout implementations.
