# Sales Manager workspace

Route: `#/sales-manager`. From My account → Local test accounts choose **Use Sales Manager demo** (`sales@takistir.local` / `SalesDemo!24`). This role is backfilled in existing local development databases without replacing accounts or inventory. Production startup does not seed demo credentials.

## Implemented flows

- Set/update pre-discount sale prices and optional unit costs; explicit zero cost is valid. Select priced products, preview a whole percentage discount and apply it together. Percentages replace rather than compound. Zero removes the discount; 100% is a free product. Catalog and detail pages show original and discounted prices.
- Signed-in customer wishlists persist in PostgreSQL. A campaign creates private in-app demo notifications for saved products whose discounted price decreases. Customers read them at `#/notifications`. Guest favourites remain browser-local and do not receive account notifications; they are not automatically transferred when signing in. This avoids attributing another browser user's favourites to an account.
- Invoice list filters purchase dates inclusively. The document retains original paid line prices, quantities and delivery address and identifies the customer rather than the viewing manager. Print / Save PDF opens the browser print dialog; select Save as PDF. Cancelled documents remain labelled in the list and contribute no revenue. Documents are demos, not tax invoices. Email delivery is separate.
- Reports display gross sales, approved refunds, net revenue, sale-time costs, returned cost reversals, net cost and profit/loss; a chart and accessible daily table use the same server data. Order dates book sales; approval dates book refunds. Dates use UTC, matching existing order dates. A refund for an older purchase can therefore produce negative revenue in a later period. Pending/rejected returns have no effect.
- Return review displays original paid unit prices and selected quantities. Store receipt must be confirmed in a separate action before approval is available. Approval records the demo refund, restocks those quantities and creates one customer notification in the same transaction. Rejection requires a reason and notifies the customer without refund or stock changes.

## Accounting and persistence

Migration `006_sales_workspace.sql` adds list prices/discount percentages, immutable-in-use order cost snapshots, persistent wishlists/notifications, campaign operation keys, receipt/audit fields and a refund ledger.

At checkout each line stores the **effective paid unit price** and **unit cost**. Missing product cost uses 50% of that paid price, rounded to cents per unit; `0` remains `0`. Historical order lines created before cost snapshots are backfilled at half their own paid price. Current product cost is not reliable historical evidence, so it is never substituted for historical costs. New fixture/import inserts missing a cost receive the same fallback through a database insert trigger. Later price/cost/discount edits never modify existing order lines.

Net revenue = gross sales − approved refunds. Net cost = sale-time costs − returned cost. Profit/loss = net revenue − net cost. Returned stock is treated as resalable, so its original cost is reversed on refund approval. This is a simplified demo model; tax, shipping fees, payment-provider settlement and damaged-stock write-offs are excluded.

Refunds use the returned quantities and the original line snapshots, not the current catalogue or an amount supplied by the browser. The return row is locked; the refund ledger has a unique return key. Receipt/approval retries are harmless. Two concurrent approvals cannot double-refund, restock or notify. Campaign keys serialize retries; reusing a key for a different selection/percentage is rejected. A later campaign with the same effective price creates no extra notification.

Product costs and financial reports are Sales Manager-only. Existing Product Manager permissions are preserved. Customers see only their own wishlist, notifications and orders. All role and receipt gates are checked server-side, including direct API requests.

## Endpoints

| Method       | Endpoint                                             | Purpose                                               |
| ------------ | ---------------------------------------------------- | ----------------------------------------------------- |
| PATCH        | `/api/sales/products/:id/pricing`                    | `{ price, cost }`; cost can be null                   |
| POST         | `/api/sales/discounts`                               | `{ ids, percent, key }`; 1–100 unique priced products |
| GET          | `/api/sales/workspace?from=YYYY-MM-DD&to=YYYY-MM-DD` | Invoice list, daily reports/totals and return queue   |
| POST         | `/api/sales/returns/:id/receive`                     | `{ confirmed: true }`; physical store receipt         |
| POST         | `/api/sales/returns/:id/approve`                     | Atomic demo refund/restock/notification               |
| POST         | `/api/sales/returns/:id/reject`                      | `{ reason }`; no stock/refund effect                  |
| PUT / DELETE | `/api/wishlist/items/:id`                            | Owning customer saved-product state                   |
| PATCH        | `/api/notifications/:id/read`                        | Mark an owning customer's notification read           |

Existing `/api/orders/:id/invoice` grants Sales Managers invoice access. Existing `/api/state` includes role-filtered wishlist/notifications, discount display fields, customer invoice identity and Sales Manager pricing fields. Mutation response conventions remain unchanged.

## Validation

15 new native PostgreSQL integration tests cover permissions/privacy, purchase snapshots, zero/default costs, monetary validation, bulk rollback, wishlist ownership, notification idempotency, receipt gating, original-price partial refunds, simultaneous approvals, rejection, date boundaries, sales/refund period accounting, cancellation and seed backfill. The full repository check passed: **84 tests**, production build and formatting, including existing cart/order/review regressions.

Isolated Chrome scenario with a fresh PostgreSQL database passed: role gate → save price/zero cost → wishlist discount notification → purchase → change price/cost → physical return receipt → refund approval → one restock/customer notification → date-filtered revenue/profit → invoice customer/paid prices → print invocation and PDF rendering. All four tabs were checked at 320, 390, 768 and 1440 px with no document overflow or page errors; screenshots were inspected. Test data does not touch the persistent local preview database.

## Integration boundary

Work is isolated on `feature/sales-manager` from main after PR #15. Nilsu's PR #14 is a separate purchase-flow change: coordinate shared edits in `Store.jsx`, `Account.jsx`, `components.jsx` and the price display in `Storefront.jsx` when merging it. This work does not replace her cart/auth/checkout clients. Real payment/refund execution and invoice email are not implemented; the requested demo actions persist locally.
