# Developer Setup

How to get this project running on a new machine, the everyday commands, and fixes for known problems.

Last updated: 2026-10-10 (Task 1.9)

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | **24 LTS** (D-27; also in `.nvmrc`) | `node -v` |
| npm | 11 or later (comes with Node 24) | `npm -v` |
| git | any recent version | `git --version` |
| Neon account | free plan | [console.neon.tech](https://console.neon.tech) |

No local PostgreSQL is needed; development and tests use Neon (D-28).

## 2. Get the code

```bash
git clone https://github.com/aswin-dev-fsd/department_store_v1.git
```

Then, inside the folder:

```bash
npm ci
```

`npm ci` installs exactly the versions in `package-lock.json`. npm 11 may warn that `esbuild` has an install script it didn't run. That's expected and harmless: everything works without it.

## 3. Databases

You need **two** Neon projects, so tests can never touch your development data:

| Project | Used by | `.env` variable |
|---|---|---|
| `dept-store-dev` | the app while you develop | `DATABASE_URL` |
| `dept-store-test` | the automated tests, which wipe it | `TEST_DATABASE_URL` |

Create both on **AWS Singapore** with **Postgres 18**. Open **Connect**, turn **Connection pooling off**, and copy each connection string. Step-by-step: [build-plan/phase-0-preflight.md](build-plan/phase-0-preflight.md), Task 0.2.

## 4. The `.env` file

Copy `.env.example` to `.env` at the repo root and paste in the two connection strings. Every other variable has a working default for development. `backend/src/config/env.schema.ts` is the source of truth for names, defaults and production rules.

`.env` is git-ignored. Never commit it, and never paste its contents into a chat or an issue.

## 5. Check the setup

```bash
npm run db:check
```

```bash
npm run db:check -- TEST_DATABASE_URL
```

Each should print `✓`, the PostgreSQL version, and `Encryption: TLSv1.3 · certificate verified: yes`. Then run every check at once:

```bash
npm run verify
```

## 6. Run the app

Use two terminals.

```bash
npm run dev:backend
```

The API runs on http://localhost:4000. Health check: http://localhost:4000/api/v1/health.

```bash
npm run dev:frontend
```

The web app runs on http://localhost:5173. The status page should show **API: ok** and **Database: ok**.

- The frontend forwards `/api/*` to the backend, the same way Vercel does when deployed, so login cookies behave identically everywhere.
- The backend restarts by itself when you edit `backend/src`. Changes to `shared/` or `database/` need a restart of both servers, because those packages are compiled first.
- In Claude Code's desktop app, `.claude/launch.json` starts both servers in the Browser pane.

## 7. Commands

All run from the repo root.

| Command | What it does |
|---|---|
| `npm run dev:backend` | Build the shared packages, then run the API with auto-restart |
| `npm run dev:frontend` | Build the shared packages, then run the Vite dev server |
| `npm run verify` | **The gate:** lint, format check, type check, all tests. Must pass before every commit |
| `npm test` | All tests in every package |
| `npm run check-types` | TypeScript check of every package |
| `npm run lint` | ESLint. Any warning fails it |
| `npm run format` | Rewrite files in Prettier style (Markdown is excluded) |
| `npm run format:check` | Report files not in Prettier style |
| `npm run build` | Production build: packages, then `backend/dist`, then `frontend/dist` |
| `npm run build:packages` | Compile `shared` and `database` (the other commands run this for you) |
| `npm run db:check [-- TEST_DATABASE_URL]` | Connect and print the server version and encryption |
| `npm run db:generate` | Create a migration from schema changes in `database/src/schema` |
| `npm run db:migrate [-- TEST_DATABASE_URL]` | Apply pending migrations |

## 8. Tests

- `npm test` runs everything. Backend tests run against `TEST_DATABASE_URL` only. A guard stops the run before connecting if that variable is missing or names your dev database.
- Backend test files run **one at a time** (they share one database), and every query crosses to Singapore, so a full run takes about 25 seconds and grows with the project.
- One package: `npm test -w @ds/backend`. One file: `npx vitest run --root backend src/modules/health/health.test.ts`.
- Database tests use `createTestDb()` and `resetDb()` from `backend/test/helpers/db.ts` (see `AGENTS.md`).

## 9. Neon free plan: what to expect

| Behaviour | What you'll notice | What to do |
|---|---|---|
| Sleeps after 5 idle minutes | The first query after a break takes 1–3 seconds | Nothing; test setup retries the wake-up automatically |
| Singapore region only | Each query takes about 50–80 ms to travel each way | Normal. Production speed is measured in its own region (Task 7.3) |
| Storage per project (about 1 GB at creation) | Plenty for development | Big volume tests use a temporary database (Task 7.3) |
| Short restore window | A broken dev database can't be rolled back far | Rebuild it (below) |

**Rebuilding a broken *dev* database** (never production):
1. In the Neon console, open **`dept-store-dev`** → SQL Editor, and run: `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`
2. Run `npm run db:migrate`.
3. Load demo data with `npm run db:seed` once Task 3.8 has added it.

## 10. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `npm install <pkg> -w @ds/x` "succeeds" but the package isn't in `x/package.json` | npm 11 quirk with a newly added workspace | Run plain `npm install` once, then repeat the command |
| `Refusing to run tests: TEST_DATABASE_URL points at the same database…` | `.env` uses one database for both | Create the separate test project (section 3) |
| `TEST_DATABASE_URL is not set` | Missing from `.env` | Add it (section 4) |
| `Invalid environment variables:` on start | A missing or invalid `.env` value | The message names each variable; fix it in `.env` |
| Status page shows **Database: down** right after a break | Neon took longer than the 5-second health limit to wake; the backend log says `Database ping timed out` | Wait a few seconds; the page re-checks every 30 seconds |
| `EADDRINUSE` on port 4000 or 5173 | A previous dev server is still running | Stop it, or close the terminal running it |
| GitHub asks which account to use on every push | More than one GitHub account is saved on this PC | Put the account in the remote: `git remote set-url origin https://aswin-dev-fsd@github.com/aswin-dev-fsd/department_store_v1.git` |
| `npm audit` reports 4 moderate issues | A known esbuild issue inside the dev tool `drizzle-kit`; not used at runtime | Accepted (Task 7.2). Never run `npm audit fix --force`: it downgrades drizzle-kit |

## 11. Staging

Filled in by Task 1.10 (Render + Vercel): URLs and settings, no secrets.
