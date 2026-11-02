# Backend — `backend/`

This folder contains the Node.js and Express application. It receives HTTP requests from the frontend and returns API responses.

## What belongs here?

- API endpoints and request validation.
- Business rules for stock, orders, payments, reviews, and refunds.
- Authentication and role-based authorization.
- Database access and integrations such as email and invoice generation.

These responsibilities will be implemented as the project develops. Currently, only the health endpoint and basic request error handling exist; there is no database connection yet.

## Current files

| File           | Purpose                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `src/index.js` | Reads host/port settings, starts the HTTP server, and handles shutdown |
| `src/app.js`   | Configures Express, defines API endpoints, and handles errors          |
| `.env.example` | Example local host and port settings                                   |

The current `GET /api/health` endpoint returns:

```json
{ "status": "ok", "service": "takistir-api" }
```

The product/category SQL migration and database checks are in [`db/`](db/README.md).
They target the PostgreSQL 17 setup on `SCRUM-39-database-setup`, which is not yet
merged into `main`. See the [schema and data dictionary](../docs/product-category-schema.md)
for the seed data contract. Applying the SQL does not connect the API to the database.

For example, implement product retrieval and stock checks here; the frontend displays the returned data. Keep database credentials and secrets on the backend, and enforce permissions here even when the frontend already hides restricted actions.

As features grow, split endpoints and business logic into focused modules rather than putting every feature in `app.js`. Keep server startup in `index.js`.

## Run locally

From the **repository root**:

```sh
npm run dev
```

The API listens at <http://127.0.0.1:3001>. To run only the backend, use `npm run dev:backend` from the repository root. Restart the command after editing backend files.

No `.env` file is required for the scaffold. To customize the settings, copy `.env.example` to `.env` inside this folder. Never commit real secrets.

See the [main README](../README.md) for installation and the [frontend guide](../frontend/README.md) for the browser application.
