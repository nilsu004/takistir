# Frontend — `frontend/`

This folder contains the React application that runs in the user's browser. Vite provides the development server and builds the frontend.

## What belongs here?

- Pages and reusable UI components.
- Styling, layouts, and user interactions.
- Browser-side state, such as the current cart view.
- HTTP requests to the backend API.

Product listings, the cart screen, login forms, and managerial screens will be developed here. These store features are not implemented yet.

## Current files

| File             | Purpose                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| `src/App.jsx`    | Main component; currently displays the placeholder page and API connection status |
| `src/styles.css` | Application styles                                                                |
| `src/main.jsx`   | Mounts the React application in the HTML page                                     |
| `index.html`     | HTML entry point                                                                  |
| `vite.config.js` | Development server configuration and `/api` proxy to the backend                  |

For example, implement a product card here and request product data from the backend. Enforce stock and permission rules again on the backend, because browser code can be bypassed. Never put database credentials or private API keys in frontend code.

## Run locally

From the **repository root**:

```sh
npm run dev
```

Open <http://127.0.0.1:5173>. Frontend edits reload automatically.

To run only the frontend, use `npm run dev:frontend` from the repository root. The API connection check requires the backend to be running too.

See the [main README](../README.md) for installation and the [backend guide](../backend/README.md) for the API structure.
