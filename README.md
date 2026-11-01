# Takıştır

CS308 team project: an accessories e-commerce website, including watches and other accessory categories. This repository currently contains a runnable workspace scaffold. Store features, authentication, database storage, email, payments, and chat are not implemented yet.

## Team

| Member | Main responsibility             |
| ------ | ------------------------------- |
| Doğa   | Frontend; later backend support |
| Nilsu  | Frontend; later backend support |
| Ceylin | Database and Scrum Master       |
| Mahmut | Database                        |
| Gence  | Backend                         |
| Ezgi   | Backend                         |

## Getting started

Use Node.js 24 LTS and npm. `.nvmrc` records the team's Node version; if you use nvm, run `nvm install` followed by `nvm use`. The initial workspace was verified using the locally installed Node.js 25.9.0.

From the repository root:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. The placeholder page should report **API connected**. The API health endpoint is <http://127.0.0.1:3001/api/health>.

Stop both servers with Ctrl+C. No database, credentials, or environment file is required for this scaffold.

## Project structure: frontend and backend

```text
frontend/     FRONTEND — React user interface, built and served locally by Vite
backend/      BACKEND — Node.js + Express HTTP API
docs/         Original guideline and implementation checklist
```

| Area                                         | Responsibility                                                                                            | Where to start         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| [Frontend (`frontend/`)](frontend/README.md) | Pages, components, styling, user interactions, and requests to the API                                    | `frontend/src/App.jsx` |
| [Backend (`backend/`)](backend/README.md)    | API endpoints, request validation, business rules, permissions, and database access as features are added | `backend/src/app.js`   |

For example, a product listing screen belongs in the frontend; an API endpoint that retrieves products and checks stock belongs in the backend. The frontend requests data from the backend over HTTP. Database credentials and other secrets belong on the backend.

Keep the existing `frontend/` and `backend/` names throughout the project so imports, npm commands, and documentation stay consistent.

Both applications use JavaScript ES modules. npm workspaces share one root lockfile and one installation command. React/Vite and Express are initial setup choices; database selection remains open. PostgreSQL is a candidate for transactional orders and stock, to be decided before implementing persistence.

## Commands

| Command                | Purpose                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run dev`          | Start the frontend and API together; frontend edits reload automatically |
| `npm run dev:frontend` | Start only the frontend                                                  |
| `npm run dev:backend`  | Start only the API                                                       |
| `npm run build`        | Generate frontend files in `frontend/dist/`                              |
| `npm start`            | Start only the API without watch mode                                    |
| `npm run check`        | Check server syntax, build the frontend, and check formatting            |
| `npm run format`       | Apply consistent formatting                                              |

`npm start` does not serve the built frontend. Hosting configuration will be added when deployment is in scope. There are no automated feature tests yet; add meaningful unit tests alongside the first features, following the course thresholds.

Restart the development command after editing API files. The API uses a plain Node process to avoid file-watcher issues on the initial development machine.

## Configuration

The API defaults to host `127.0.0.1` and port `3001`. To override these, copy `backend/.env.example` to `backend/.env`. If you change the API port, also update the proxy target in `frontend/vite.config.js`. Vite forwards frontend `/api` requests to the API during development.

Keep secrets in ignored environment files. Variables exposed to the browser must never contain secrets. `.env.example` files should contain placeholders only.

## Course workflow

Track work in [Jira](https://watchstore.atlassian.net/jira/software/projects/SCRUM/boards/1/backlog).

Read [the requirement checklist](docs/requirements.md) before adding features. The [original pasted guideline](docs/course-guideline.txt) is preserved as the source of truth.

Work in small feature branches. Link work to a sprint backlog item, write acceptance criteria, test the behavior, and record real defects as bug reports. Each contributor should be able to explain the code and design choices they submit during demos.

Commit `package-lock.json` when dependencies change. Teammates should use `npm ci` to install the recorded dependency versions.

Framework references: [Vite guide](https://vite.dev/guide/), [Express installation](https://expressjs.com/en/starter/installing/), [Node.js release information](https://nodejs.org/en/about/previous-releases).
