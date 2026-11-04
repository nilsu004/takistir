# Frontend — `frontend/`

This folder contains the React application that runs in the user's browser. Vite provides the development server and builds the frontend.

## Interactive preview

- Home and product details use the Figma design's colors, fonts and original local SVG assets.
- Catalog/search/sorting, cart, wishlist, demo login/registration, checkout, profile, orders, cancellation, item returns, invoice printing and demo chat can be explored.
- Cart and wishlist persist in localStorage. Session, stock, orders and reviews reset on refresh.
- This is a browser-only preview: no real authentication, payment, email, file upload, database or support agent connection. Manager screens are not implemented.

The Figma tool quota allowed detailed reads of Home and Product details only. Additional customer flows use the same visual language; they are not a pixel-exact conversion of every Figma screen. Read [the Turkish guide](../ONIZLEME.md) for an inspection walkthrough.

## Current files

| File                 | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `src/App.jsx`        | Hash-based page routing                                          |
| `src/components.jsx` | Shared header, footer, cards, form controls and chat             |
| `src/Storefront.jsx` | Home, catalog, product, cart, wishlist and information pages     |
| `src/Checkout.jsx`   | Delivery, mock payment and confirmation                          |
| `src/Account.jsx`    | Login, profile, orders, returns and invoice                      |
| `src/Store.jsx`      | Shared preview state and actions                                 |
| `src/data.js`        | Sample data and formatting helpers                               |
| `src/styles.css`     | Application styles                                               |
| `src/main.jsx`       | Mounts the React application in the HTML page                    |
| `index.html`         | HTML entry point                                                 |
| `vite.config.js`     | Development server configuration and `/api` proxy to the backend |

For example, implement a product card here and request product data from the backend. Enforce stock and permission rules again on the backend, because browser code can be bypassed. Never put database credentials or private API keys in frontend code.

## Run locally

From the **repository root**:

```sh
npm run dev --workspace frontend -- --port 5174
```

Open <http://127.0.0.1:5174>. Frontend edits reload automatically. Use **Use demo account** on the login page to continue without credentials.

To build, run `npm run build` from the repository root. No new runtime dependencies were added.

See the [main README](../README.md) for installation and the [backend guide](../backend/README.md) for the API structure.
