# Course requirements and implementation checklist

Source: [original pasted course guideline](course-guideline.txt). This is a course-level acceptance checklist. Local storefront/manager integration exists; unchecked items still need end-to-end acceptance and team review. See [Sprint 2–3 frontend notes](sprint-2-3-frontend.md) for the current scope and backend gaps.

The selected product domain is accessories, including watches and other accessory categories.

## Progress demo

The guideline explicitly requires features **1, 3, 4, 5, 7, and 9** at the progress demo. Build these as complete flows, including the dependencies needed to demonstrate them.

- [ ] 1: Browse products in categories and add products to a cart.
- [ ] 3: Show stock, decrease it after successful purchase, forward delivery details, and show processing / in-transit / delivered in order history.
- [ ] 4: Allow guest browsing and carts; require login before checkout; retain the guest cart after login; confirm mock payment; display an invoice and email its PDF.
- [ ] 5: Allow ratings and comments only for purchased, delivered products; publish ratings immediately and comments only after product-manager approval.
- [ ] 7: Search names and descriptions, sort by price or popularity, keep out-of-stock products searchable, and prevent adding them to the cart.
- [ ] 9: Include product ID, name, model, serial number, description, stock quantity, price, warranty status, and distributor information.

The progress demo therefore also needs supporting account, role, delivery-status, moderation, and payment behavior. Define the popularity metric before implementing sorting.

## Full requirement map

| Guideline | Required behavior                                                                                                                                                         | Weight where stated |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1         | Products, categories, selection, shopping cart                                                                                                                            | —                   |
| 2         | Choose the store's product domain                                                                                                                                         | —                   |
| 3         | Stock tracking, delivery handoff, order status and history                                                                                                                | 8%                  |
| 4         | Guest cart, login retention, mock payment, onscreen and emailed PDF invoice                                                                                               | 8%                  |
| 5         | Delivered-purchase reviews, immediate ratings, moderated comments                                                                                                         | 8%                  |
| 6         | Attractive, usable, professional interface                                                                                                                                | 8%                  |
| 7         | Name/description search, price/popularity sorting, out-of-stock rules                                                                                                     | 8%                  |
| 8         | Customer website and custom managerial interface                                                                                                                          | 8%                  |
| 9         | All required product fields                                                                                                                                               | —                   |
| 10        | Customer, sales manager, product manager, support agent roles                                                                                                             | —                   |
| 11        | Sales-manager prices and discounts; wishlist discount notifications; invoice date filtering, print/PDF; revenue and profit/loss chart                                     | 8%                  |
| 12        | Product-manager products, categories, stock, invoices, delivery list/status, comment approval or rejection                                                                | 8%                  |
| 13        | Real-time guest/account support chat from any page; text and PDF/image/video attachments; agent queue and claiming; linked customer context                               | 13%                 |
| 14        | Customer profile, wishlist, orders, cancellation only while processing, refund eligibility only when delivered                                                            | 8%                  |
| 15        | Credit-card input for mock payment; card verification and limit checks are out of scope                                                                                   | 2%                  |
| 16        | Selective item returns within 30 days of purchase after delivery; sales-manager evaluation and refund after receipt; restock, original paid amount, customer notification | 8%                  |
| 17        | Defensive programming, protected sensitive data, distinct role privileges                                                                                                 | 2%                  |
| 18        | Reliable concurrent use by users in different roles                                                                                                                       | 3%                  |

Customer records must include ID, name, tax ID, email, home address, and password credentials. The profile page displays name, email, and home address. Store password hashes rather than plaintext passwords.

Delivery lists must include delivery ID, customer ID, product ID, quantity, total price, delivery address, and completion status.

For profit/loss, the guideline allows cost to default to 50% of the sale price or to be supplied by the product manager. Record purchase-time prices so later price changes or campaign endings cannot change refunds or invoices.

## Design constraints to preserve

- Enforce permissions and state transitions in the API, including requests sent outside the UI.
- Use database transactions or equivalent atomic operations for stock, payments, cancellations, and refunds. Concurrent purchases must not oversell stock; retries must not duplicate charges, refunds, or restocking.
- Treat payment as a mock integration. Do not persist raw card numbers or security codes; retain only non-sensitive mock payment references.
- The guideline uses “hashed” broadly for sensitive data, including invoices and accounts. Passwords need one-way password hashing. Invoices and profile details must remain retrievable, so plan encryption and access controls for those records and clarify the expected interpretation with the TA before implementing storage.
- Only the product manager manages stock. Coordinate refund-authorized restocking through the stock service and record the actor and cause; clarify the intended role boundary with the TA if needed.
- Protect invoice downloads, chat context, and attachments with server-side access rules. Validate upload type and size before accepting files.
- Plan email delivery for invoice PDFs, wishlist discounts, and refund approvals; a browser-only notification does not complete the invoice email requirement.

## Suggested implementation order

1. Confirm the initial accessory categories, database, data model, API conventions, and initial backlog.
2. Implement products/categories, inventory, search/sorting, and guest carts.
3. Add accounts, role authorization, profile, cart retention, and mock checkout with atomic stock changes.
4. Complete order history, delivery status, invoice PDF/email, and review eligibility/moderation for the progress demo.
5. Extend the managerial interfaces with pricing, campaigns, wishlist notifications, and financial reports.
6. Complete cancellations, selective returns/refunds, and live support with attachments and customer context.
7. Validate complete flows, concurrency, security, accessibility, and final-demo readiness throughout development.

This order is a starting point for sprint planning, not a replacement for a team-owned sprint backlog.

## Schedule and evidence

- Two-week sprints overlap with planning for the next sprint.
- Sprint 1 starts in week 4; sprint 2 in week 6; sprint 3 in week 8; sprint 4 in week 10; sprint 5 in week 13.
- Progress demo: week 11. Final demo: TBA. Calendar dates are not given.
- Planning: weeks 4, 5, 7, 9, and 12. Reviews/retrospectives: weeks 6, 8, 10, 13, and 14.
- TA meetings run for 30 minutes. For reviews/retrospectives, the TA joins the last 15 minutes of review and the first 15 minutes of retrospective; the team meets before and stays after that slot.
- Overall project weighting: progress demo 40%, final demo 60%.
- Each demo: presentation 50%, SCRUM participation 30%, development activity 20%.
- Development activity thresholds per demo: at least **5 commits per member**, **25 new unit tests**, **5 new bug reports**, and **30 sprint backlog items**. The corresponding development-activity weights are 20%, 20%, 20%, and 40%.
- Contributions must be substantive and spread over the sprints. Track actual work and defects rather than creating filler to meet thresholds.
- AI assistance is allowed, but every contributor must understand, verify, and explain their work in technical questions.
