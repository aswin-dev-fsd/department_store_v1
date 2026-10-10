# Phase 1 — Foundation

**Goal:** an empty but complete monorepo. Shared libraries, a database connection, an Express app with a health endpoint, a test harness, and a frontend shell that shows the API status. Every later phase builds on these conventions.

**Read first for the whole phase:** `AGENTS.md`, overview §4 (Architecture), D-27 (Node version).

**Conventions fixed in this phase:**

| Topic | Convention |
|---|---|
| Package names | `@ds/shared`, `@ds/database`, `@ds/backend`, `@ds/frontend` |
| Module system | ESM (`"type": "module"`) everywhere |
| Internal packages | `shared` and `database` compile with `tsc` to `dist/`; `backend` and `frontend` import the built output through the package `exports`, so no TypeScript project references are needed. Each package has `tsconfig.json` (type-check, includes tests, `noEmit`) and `tsconfig.build.json` (emit to `dist`, excludes tests) — copy the `shared` pattern. Root script `build:packages` builds them, and runs before `dev`, `test` and `check-types`. |
| Root gate scripts | `check-types` and `test` exist at the root from Task 1.2 and run every workspace (`--workspaces --if-present`), so the protocol gate works from the start. Each new package adds itself to `build:packages` as needed. |
| Environment | One `.env` at the repo root, read by backend and database scripts |
| Versions | Latest stable of each approved package, saved exactly (`.npmrc` → `save-exact=true`) |
| TypeScript | **6.0.x**, installed once at the root and shared by all workspaces. Not 7.x until `typescript-eslint` supports it (its peer range on 2026-10-10: `<6.1.0`) |

---

## Task 1.1 — Root workspace

**Goal:** the root `package.json` and shared config exist, and `npm install` works.

**Files:** `package.json`, `.npmrc`, `.nvmrc`, `.editorconfig`, `tsconfig.base.json`, `README.md`

**Steps:**
1. `package.json`:
   - `"name": "department-store"`, `"private": true`, `"type": "module"`
   - `"engines": { "node": ">=<D-27 major>" }`
   - `"workspaces": []` — each later task adds its package to this list when it creates the folder
2. `.npmrc`: `save-exact=true`. `.nvmrc`: the Node major version from D-27.
3. `.editorconfig`: UTF-8, LF line endings, 2-space indent, final newline.
4. `tsconfig.base.json`:
   - `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
   - `forceConsistentCasingInFileNames`, `skipLibCheck`, `isolatedModules`
   - `target` ES2023, `module` / `moduleResolution` `NodeNext`, `declaration`, `sourceMap`
5. Install root dev dependencies: `typescript`, `vitest`, `tsx`.
6. `README.md`: one paragraph describing the project, plus links to `docs/project-overview.md` and `docs/dev-setup.md` (written in Task 1.9).

**Done when:**
- [ ] `npm install` succeeds
- [ ] `npx tsc -v` prints a version

**Commit:** `chore(repo): add root workspace and typescript base config`

---

## Task 1.2 — Shared package and money helpers

**Goal:** `@ds/shared` exists, builds, and has tested money helpers that every other package will use.

**Read first:** overview §5.4 (money rules).

**Files:**
- `shared/package.json` — `exports` → `dist`; scripts `build`, `check-types`, `test`
- `shared/tsconfig.json` — extends the base, `noEmit`, includes `src` (tests too). Used by `check-types` and the editor.
- `shared/tsconfig.build.json` — extends `tsconfig.json`; `rootDir: src`, `outDir: dist`; excludes `*.test.ts`. Used by `build`.
- `shared/vitest.config.ts`
- `shared/src/index.ts`, `shared/src/money.ts`, `shared/src/money.test.ts`
- Root `package.json` — add `shared` to `workspaces`; add the `build:packages` script

**Steps:**
1. **Red** — write tests:
   - `rupeesToPaise('145.50') === 14550`, `('145.5') === 14550`, `('145') === 14500`, `('0') === 0`
   - `rupeesToPaise` throws on `'1.234'`, `'-5'`, `'abc'`, `''`
   - `formatPaise(14550) === '₹145.50'`, `formatPaise(103600) === '₹1,036.00'`, `formatPaise(10000000) === '₹1,00,000.00'` (Indian digit grouping)
2. **Green** — implement:
   - `rupeesToPaise` parses the string into whole rupees and paise using integers only — no `parseFloat(x) * 100`.
   - `formatPaise` uses `Intl.NumberFormat('en-IN')`.
3. Export both from `src/index.ts`.

**Done when:**
- [ ] `npm run build -w @ds/shared` produces `shared/dist`
- [ ] `npm test -w @ds/shared` passes
- [ ] `npm run check-types -w @ds/shared` passes

**Commit:** `feat(shared): add money helpers in paise`

---

## Task 1.3 — Lint and format

**Goal:** one lint and format setup for the whole repo. *Skip this task if lint was declined in Task 0.1.*

**Files:** `eslint.config.js`, `.prettierrc`, `.prettierignore`; root `package.json` scripts `lint`, `format`, `format:check`

**Steps:**
1. ESLint flat config: `@eslint/js` recommended + `typescript-eslint` recommended; `eslint-plugin-react-hooks` for `frontend/**`.
2. Rules:
   - `no-console: error` (DreamLand §5 — use the logger)
   - `eqeqeq: error`
   - `@typescript-eslint/no-explicit-any: error`
3. Ignore `dist`, `coverage`, `node_modules`, and generated migrations.
4. Prettier: single quotes, trailing commas, print width 100.
5. Run `npm run format` once, then fix any lint errors.

**Done when:**
- [ ] `npm run lint` passes
- [ ] `npm run format:check` passes

**Commit:** `chore(repo): add eslint and prettier`

---

## Task 1.4 — Database package

**Goal:** `@ds/database` connects to PostgreSQL through Drizzle and can run migrations.

**Read first:** overview §4.3 (Data access row).

**Files:**
- `database/package.json`, `database/tsconfig.json`, `database/drizzle.config.ts`
- `database/src/client.ts` — `createDb(url)` returns `{ db, pool }`
- `database/src/schema/index.ts` — empty for now
- `database/src/migrate.ts`, `database/src/check.ts`, `database/src/index.ts`
- Added during the build: `database/src/cli.ts` (env loading and CLI output helpers) and `database/src/migrator.ts` (`runMigrations(url)`, which returns `false` while no migrations exist), with tests
- Root `package.json` — add `database` to `workspaces` and `build:packages`; add root scripts `db:generate`, `db:migrate`, `db:check`

**Steps:**
1. Install `drizzle-orm`, `pg`, `dotenv`; dev: `drizzle-kit`, `@types/pg`.
2. `client.ts`: a `pg` Pool built from the URL, wrapped with Drizzle. No URL is read inside this file; callers pass it in.
   - Neon URLs end with `sslmode=require&channel_binding=require`. TLS must stay on.
   - If the `pg` driver warns about or rejects either parameter, handle it in `createDb` (e.g. the driver's SSL / channel-binding options) and note the fix in `progress.md`. Never by turning TLS off.
3. `migrate.ts`: loads the root `.env`, runs Drizzle's migrator on `DATABASE_URL`, closes the pool. Exits non-zero on failure.
4. `check.ts`: connects and prints `select version()` — the connection check deferred from Task 0.2.
5. `drizzle.config.ts`: schema `./src/schema/index.ts`, migrations folder `./migrations`, dialect `postgresql`.

**Done when:**
- [ ] `npm run db:check` prints the PostgreSQL version for `DATABASE_URL`
- [ ] It also works with `TEST_DATABASE_URL` substituted
- [ ] `npm run build -w @ds/database` passes

**Commit:** `feat(database): add drizzle client, migration runner and connection check`

---

## Task 1.5 — Backend libraries: env, logger, errors, response

**Goal:** the backend's base libraries exist and are tested: typed env, logger, error classes, and the response envelope.

**Read first:** DreamLand §7 (envelope), §8 (errors), §11 (env); overview §4.8 (env vars); `AGENTS.md` overrides table.

**Files:**
- `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`
- `backend/src/config/env.ts` + `env.test.ts`
- `backend/src/lib/logger.ts`
- `backend/src/lib/errors.ts` + `errors.test.ts`
- `backend/src/lib/response.ts` + `response.test.ts`
- `.env.example` at the root
- Root `package.json` — add `backend` to `workspaces`

**Steps:**
1. Install `express`, `helmet`, `cors`, `pino`, `pino-http`, `dotenv`, `zod`; dev: `@types/express`, `@types/cors`, `supertest`, `@types/supertest`. Depend on `@ds/shared` and `@ds/database` (`"*"`).
2. **Red** — tests:
   - `env`: a valid set of values parses; a missing `DATABASE_URL` throws a message naming the variable.
   - `errors`: each class has the right `statusCode` and `code` — `AppError` 400, `ValidationError` 422, `AuthError` 401, `ForbiddenError` 403, `NotFoundError` 404.
   - `response`: `success(data)` → `{ success: true, data, meta: { timestamp, version } }`; `failure(code, message, details?)` → `{ success: false, error: {…}, meta }`. `timestamp` is ISO-8601; `version` comes from `backend/package.json`.
3. **Green** — implement:
   - `env.ts` parses `process.env` once with zod and exports a typed `env`. Variables are listed in overview §4.8. `COOKIE_SECURE` is a boolean, `SESSION_TTL_HOURS` a number with default `12`.
   - `logger.ts` exports one pino instance whose level comes from `env`.
4. `.env.example` lists every variable with placeholder values.

**Done when:**
- [ ] `npm test -w @ds/backend` passes
- [ ] `npm run check-types -w @ds/backend` passes
- [ ] No file other than `env.ts` reads `process.env`

**Commit:** `feat(backend): add env, logger, error and response libraries`

---

## Task 1.6 — Express app and health endpoint

**Goal:** `GET /api/v1/health` works, behind the full middleware stack, with central error handling.

**Read first:** overview §4.5 (request lifecycle), DreamLand §9 (security defaults).

**Files:**
- `backend/src/app.ts` — `createApp()`, no `listen`
- `backend/src/server.ts` — `listen` and graceful shutdown
- `backend/src/routes.ts` — mounts everything under `/api/v1`
- `backend/src/middleware/errorHandler.ts`, `backend/src/middleware/notFound.ts`
- `backend/src/modules/health/health.routes.ts`, `health.controller.ts`, `health.test.ts`
- `backend/src/db.ts` — creates the app's single `db` from `env.DATABASE_URL`

**Steps:**
1. **Red** — Supertest tests:
   - `GET /api/v1/health` → 200, envelope with `status: 'ok'`, `uptimeSeconds`, `database: 'ok'`
   - Unknown route → 404 envelope, code `NOT_FOUND`
   - A test-only route throwing `AppError` → 400 envelope with the same code
   - A test-only route throwing a plain `Error` → 500, code `INTERNAL_ERROR`, a generic message, and no stack trace in the body
2. **Green** — `createApp()` registers, in order:
   1. `helmet()`
   2. `cors({ origin: env.CORS_ORIGIN, credentials: true })`
   3. `express.json({ limit: '1mb' })`
   4. `pino-http`, with `req.headers.cookie` and `authorization` redacted and no bodies logged
   5. routes
   6. `notFound`
   7. `errorHandler`
3. `errorHandler`:
   - Typed errors → `failure(...)` with their status.
   - `ZodError` → 422 `VALIDATION_ERROR` with `details`.
   - Anything else → log the full error, then return 500 generic.
4. Health runs `select 1`. If the database fails, it returns 200 with `database: 'down'`.

**Done when:**
- [ ] All four tests pass
- [ ] `npm run dev -w @ds/backend` starts and `curl http://localhost:<PORT>/api/v1/health` returns `ok`

**Commit:** `feat(health): add express app, error handling and health endpoint`

---

## Task 1.7 — Test database harness

**Goal:** backend tests run against `TEST_DATABASE_URL`, with migrations applied and a clean database for every test file.

**Files:**
- `backend/test/global-setup.ts` — runs migrations on `TEST_DATABASE_URL` once, using `runMigrations` from `@ds/database`. It returns `false` and does nothing until Task 2.1 generates the first migration.
- `backend/test/setup-env.ts` — sets `process.env.DATABASE_URL = TEST_DATABASE_URL` before any app import
- `backend/test/helpers/db.ts` — `resetDb()` truncates every app table (`RESTART IDENTITY CASCADE`), skipping Drizzle's migrations table
- `backend/vitest.config.ts`

**Steps:**
1. Configure Vitest: `globalSetup`, `setupFiles`, and `fileParallelism: false`, so DB test files don't collide. Tests inside a file may still run requests in parallel.
2. Guard: if `TEST_DATABASE_URL` equals the dev `DATABASE_URL` from `.env`, abort with an error. Tests must never touch the dev database.
3. Point the health test from Task 1.6 at the test database.
4. Neon free plan (D-28) adjustments:
   - Every query crosses the internet to Singapore, so give tests a 30-second timeout.
   - The database sleeps after 5 idle minutes. In `global-setup.ts`, run a `select 1` with retries (up to 3 tries, 5 seconds apart) before migrating, so the first test doesn't fail on a cold start.
   - Test pool size: 20 connections. Concurrency tests need several connections at the same moment, and the smallest Neon compute allows about 100.

**Done when:**
- [ ] `npm test -w @ds/backend` passes against the test database
- [ ] Setting `TEST_DATABASE_URL` to the dev URL makes the run abort with the guard message

**Commit:** `test(backend): add test database harness`

---

## Task 1.8 — Frontend shell

**Goal:** the React app runs, talks to the API through a proxy, shows the API status, and has the i18n and API-client foundations.

**Read first:** overview §4.6 (screens); D-25 (language).

**Files:**
- `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/index.html`
- `frontend/src/main.tsx`, `frontend/src/App.tsx` (router + QueryClient), `frontend/src/index.css` (Tailwind)
- `frontend/src/i18n/en.ts`, `frontend/src/i18n/t.ts` + `t.test.ts`
- `frontend/src/api/client.ts` + `client.test.ts`
- `frontend/src/pages/StatusPage.tsx`
- Root `package.json` — add `frontend` to `workspaces`

**Steps:**
1. Create the files by hand. Avoid interactive generators.
2. Install `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`; dev: `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `@types/react`, `@types/react-dom`.
3. Vite: proxy `/api` to the backend port.
4. **Red** — tests:
   - `t('status.title')` returns the English text. An unknown key is a **type error**: keys are derived from the `en.ts` object.
   - `client.get('/health')` unwraps `data` from the envelope.
   - An error envelope throws `ApiError` with `code`, `message` and `details`.
5. **Green** — implement:
   - `t.ts`: a typed lookup into `en.ts`.
   - `client.ts`: `fetch` wrapper with `credentials: 'include'` and JSON handling.
6. `StatusPage`: shows "API: ok" or "API: unreachable", using TanStack Query. All text goes through `t()`.

**Done when:**
- [ ] `npm test -w @ds/frontend` passes
- [ ] `npm run build -w @ds/frontend` passes
- [ ] With both dev servers running, the page shows "API: ok"

**Commit:** `feat(frontend): add vite react shell with i18n and api client`

---

## Task 1.9 — Root scripts and dev setup guide

**Goal:** one set of root commands runs everything, and a new developer (or agent) can set up from the docs alone.

**Files:** root `package.json` scripts; `docs/dev-setup.md`

**Steps:**
1. Root scripts:
   - `build:packages` — shared, then database
   - `check-types` — all workspaces
   - `lint`
   - `test` — all workspaces, after `build:packages`
   - `dev:backend`, `dev:frontend`
   - `db:generate`, `db:migrate`, `db:check`
   - `build` — packages, then backend `tsc`, then frontend `vite build`
2. `docs/dev-setup.md`:
   - Prerequisites (Node per D-27, PostgreSQL)
   - Creating `.env` from `.env.example`
   - Creating the dev and test databases (point to Task 0.2)
   - Every root command with a one-line description
   - Running both dev servers
   - A "Neon free plan: what to expect" section: the sleep after 5 idle minutes, Singapore latency, the per-project storage limit, and restoring a broken dev database by re-running migrations + `db:seed`
3. Simulate a fresh clone: delete `node_modules` and every `dist`, then run the full gate.

**Done when:**
- [ ] `npm ci && npm run build:packages && npm run check-types && npm run lint && npm test` passes from the clean state

**Commit:** `chore(repo): add root scripts and dev setup guide`

---

## 🛑 Checkpoint 1

Agent: follow the checkpoint steps in `README.md`.

**Checkpoint review (user):**
- [ ] Run `npm run dev:backend` and `npm run dev:frontend`, open the frontend URL, and see "API: ok"
- [ ] Stop the database and reload: the page still loads, and health reports `database: down`
- [ ] Skim the repo layout against overview §4.4
