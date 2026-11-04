# Takıştır

An accessories e-commerce website for our CS308 course project, focused on watches and other accessories.

We're using React and Vite for the frontend, and Node.js with Express for the backend. The project includes an interactive customer-facing frontend preview with sample data. PostgreSQL product and category schema files are available in [backend/db](backend/db/README.md); backend store APIs and the frontend's database integration are still to be developed. See [ONIZLEME.md](ONIZLEME.md) for the Turkish preview guide and current limitations.

## Team

| Member | Responsibility                  |
| ------ | ------------------------------- |
| Doğa   | Frontend; later backend support |
| Nilsu  | Frontend; later backend support |
| Ceylin | Database and Scrum Master       |
| Mahmut | Database                        |
| Gence  | Backend                         |
| Ezgi   | Backend                         |

## Run locally

Use Node.js 24 LTS. From the project folder, run:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Both the frontend and backend start with this command. The preview uses sample data and does not require the backend. To run the preview on its own at port 5174, use `npm run dev --workspace frontend -- --port 5174`.

Stop with `Ctrl+C`. Restart after changing backend code; frontend changes reload automatically. No `.env` file or separately installed database is needed for local testing. Node.js 24 supplies SQLite. Known test accounts are seeded on first startup; production mode is intentionally disabled. See [backend setup](backend/README.md) and the [integration test guide](PRODUCT_MANAGER_DEMO.md).

## Project structure

```text
frontend/   React pages, components and styles
backend/    Express API and backend logic
docs/       Course guideline and requirements
```

File details are in the [frontend README](frontend/README.md) and [backend README](backend/README.md).

## Useful commands

| Command                | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `npm run dev:frontend` | Run only the frontend                     |
| `npm run dev:backend`  | Run only the backend                      |
| `npm run build`        | Build the frontend                        |
| `npm test`             | Run API integration and shared rule tests |
| `npm run check`        | Run tests, build and formatting checks    |
| `npm run format`       | Format the code                           |

## Planning

We track tasks and sprints in [Jira](https://watchstore.atlassian.net/jira/software/projects/SCRUM/boards/1/backlog). The [requirements checklist](docs/requirements.md) covers the course features and demo expectations, based on the [course guideline](docs/course-guideline.txt).
