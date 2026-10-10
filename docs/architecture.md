# Architecture

How the system is built and deployed **as it exists today**. For business rules and the plan, see [project-overview.md](project-overview.md); for decisions, [pending-decisions.md](pending-decisions.md).

Last updated: 2026-10-10 · State: end of Phase 1 (foundation + staging deploy). Login, data and business features arrive from Phase 2 onwards.

## Contents

1. [At a glance](#1-at-a-glance)
2. [Environments](#2-environments)
3. [Staging deployment topology](#3-staging-deployment-topology)
4. [Repository and packages](#4-repository-and-packages)
5. [Backend](#5-backend)
6. [Database layer](#6-database-layer)
7. [Frontend](#7-frontend)
8. [Shared contract](#8-shared-contract)
9. [Security](#9-security)
10. [Testing architecture](#10-testing-architecture)
11. [Build and deploy pipeline](#11-build-and-deploy-pipeline)
12. [Free-tier limits and operations](#12-free-tier-limits-and-operations)
13. [Versions](#13-versions)
14. [Known gaps](#14-known-gaps)
15. [Keeping this document current](#15-keeping-this-document-current)

---

## 1. At a glance

```
                 ┌───────────────── one repo (npm workspaces) ─────────────────┐
                 │  shared/  ── types, money helpers, API envelope             │
                 │  database/── Drizzle client, migrations, db:check           │
                 │  backend/ ── Express API  (uses shared + database)          │
                 │  frontend/── React app    (uses shared)                     │
                 └──────────────────────────────────────────────────────────────┘
                         │ git push main (GitHub: aswin-dev-fsd/department_store_v1)
           ┌─────────────┴──────────────┐
           ▼                            ▼
   Vercel builds frontend/      Render builds backend/ (+ runs migrations)
           │                            │
Browser ──►│ Vercel edge ── /api/* ────►│ Render, Singapore ───► Neon Postgres 18, Singapore
           │ (static app)   rewrite     │ (Node 24, Express)        (dept-store-staging)
```

- **One TypeScript codebase**, four packages, one lockfile.
- **One origin for the browser:** the web app and `/api` share an address, so session cookies are first-party everywhere — locally through Vite's proxy, on staging through Vercel's rewrite.
- **Three PostgreSQL databases** — dev, test, staging — each a separate Neon project, so none can damage another.

---

## 2. Environments

| Environment | Runs where | Web app | API | Database (Neon project) | Purpose |
|---|---|---|---|---|---|
| **Development** | Your PC | http://localhost:5173 (Vite) | http://localhost:4000 (tsx watch) | `dept-store-dev` | Writing code |
| **Tests** | Your PC | — | in-process (Supertest) | `dept-store-test` — wiped by tests | Automated checks (`npm run verify`) |
| **Staging** | Vercel + Render | https://dept-store-staging.vercel.app | https://dept-store-api-staging.onrender.com | `dept-store-staging` | Dev-only online copy: catch hosting problems early, demo, rehearse releases (D-31) |
| **Production** | *Planned — AWS leaning (PD-03)* | — | — | its own | The client's live store |

All three Neon projects: AWS **Singapore** (`aws-ap-southeast-1`), **PostgreSQL 18.6**, direct (non-pooled) connections.

---

## 3. Staging deployment topology

### 3.1 Request flow

```
1. Browser ──HTTPS──► Vercel edge (nearest PoP; observed bom1 = Mumbai)
2.   static files (/, /assets/*) ........ served by Vercel directly
3.   /api/*  ── rewrite (frontend/vercel.json) ──HTTPS──► dept-store-api-staging.onrender.com
4.                Render proxy ──► Node process (Express, PORT=10000 given by Render)
5.                   Express ──TLS 1.3, verified cert, channel binding──► Neon (Singapore)
6. Response travels back the same way; the browser only ever sees dept-store-staging.vercel.app
```

| Rule in `frontend/vercel.json` | Effect |
|---|---|
| `/api/:path*` → `https://dept-store-api-staging.onrender.com/api/:path*` | API calls proxied to Render; same origin for the browser |
| `/(.*)` → `/index.html` | Client-side routes (e.g. `/bills/42`) load the app instead of 404. Real files are served first; rewrites only apply when no file matches |

### 3.2 Why this shape

| Choice | Reason |
|---|---|
| Vercel rewrite instead of calling Render directly | A browser call to `onrender.com` from `vercel.app` would make the session cookie *third-party*, which browsers block. Through the rewrite it is first-party (SameSite `lax`) and no CORS preflight is needed |
| Render and Neon in the **same region** (Singapore) | Each bill makes several database round trips; keeping them inside one region makes them ~1 ms instead of ~60 ms each. Only the browser ↔ Singapore hop crosses the sea, once per request |
| Separate staging database | Local experiments and test runs never break the online copy; Render's migrations never touch the database you're developing on |
| `TRUST_PROXY=2` | Two proxies (Vercel, Render) sit in front of Express; `req.ip` must come from `X-Forwarded-For` for rate limiting and audit IPs |

### 3.3 Service settings

| Service | Setting | Value |
|---|---|---|
| **Vercel** project `dept-store-staging` | Root Directory | `frontend` |
| | Install Command | `cd .. && npm ci --include=dev` |
| | Build Command | `cd .. && npm run build:packages && npm run build -w @ds/frontend` |
| | Output Directory | `dist` |
| | Node.js | 24.x |
| | Plan | Hobby — non-commercial; acceptable for this dev-only copy (D-31) |
| **Render** web service `dept-store-api-staging` | Region / plan | Singapore / Free |
| | Root Directory | *(blank — repo root, needed for workspaces)* |
| | Build Command | `npm ci --include=dev && npm run build:packages && npm run build -w @ds/backend && npm run db:migrate` |
| | Start Command | `node backend/dist/server.js` |
| | Health check path | `/api/v1/health/live` (no database call — see §12) |
| | Auto-deploy | On commit to `main` |
| | Env vars | `NODE_ENV=production`, `NODE_VERSION=24`, `DATABASE_URL` *(secret)*, `CORS_ORIGIN=https://dept-store-staging.vercel.app`, `COOKIE_SECURE=true`, `SESSION_TTL_HOURS=12`, `LOG_LEVEL=info`, `TRUST_PROXY=2` |
| **Neon** project `dept-store-staging` | Region / version | AWS Singapore / Postgres 18 |
| | Connection | direct (pooling off); string stored only in Render |

`--include=dev` matters: Render applies `NODE_ENV=production` during the build too, and plain `npm ci` would then skip TypeScript and the other build tools.

---

## 4. Repository and packages

```
department_store_v1/
├── AGENTS.md              rules for developers and AI agents
├── package.json           workspaces + root scripts (verify, dev:*, build, db:*)
├── tsconfig.base.json     strict TypeScript settings shared by every package
├── eslint.config.js       one lint config (React hooks rules only for frontend/)
├── .env.example           every env var with placeholders (.env is git-ignored)
├── .gitattributes         LF line endings everywhere
├── .claude/launch.json    dev servers for Claude Code's Browser pane
├── docs/                  plans, decisions, this document
├── shared/                @ds/shared
├── database/              @ds/database
├── backend/               @ds/backend
└── frontend/              @ds/frontend   (+ vercel.json)
```

| Package | Purpose | Output | Used by |
|---|---|---|---|
| `@ds/shared` | API contract: money helpers (paise), response-envelope types, health types; later zod schemas and the permission map | `shared/dist` (tsc, incremental) | backend, frontend |
| `@ds/database` | Drizzle client (`createDb`), TLS/connection settings, migration runner, `db:check` / `db:migrate` / `db:generate` CLIs, schema (empty until Phase 2) | `database/dist` (tsc, incremental) | backend |
| `@ds/backend` | Express API | `backend/dist` (tsc) | deployed to Render |
| `@ds/frontend` | React single-page app | `frontend/dist` (Vite) | deployed to Vercel |

**How packages connect:** `backend` and `frontend` import `@ds/shared` / `@ds/database` through npm workspace links, resolving to each package's built `dist/` via its `exports`. No TypeScript project references are needed. `npm run build:packages` compiles them, and every dev/test/check command runs it first.

**Incremental package builds** (`incremental` + `dist/.tsbuildinfo`): a rebuild with nothing changed writes no files. Without this, starting the frontend dev server rewrote `database/dist`, which made the backend's watcher restart mid-request (found in Task 1.9).

---

## 5. Backend

### 5.1 Process and composition

| File | Role |
|---|---|
| `src/server.ts` | Entry point: creates the app, `listen(PORT)`, graceful shutdown on SIGTERM/SIGINT (stop accepting, finish in-flight requests, close the DB pool; force-exit after 10 s) |
| `src/app.ts` | `createApp(deps, { trustProxy })` builds the Express app without listening, so tests drive it with Supertest |
| `src/deps.ts` | `AppDeps` — what routes need from outside (today: `db`). Passed in, so tests supply a real test DB or a fake |
| `src/db.ts` | The process-wide pool: `createDb(env.DATABASE_URL)` (max 10 connections) |
| `src/routes.ts` | Mounts every module's router under `/api/v1` |
| `src/modules/<feature>/` | One folder per feature: `routes` → `controller` (req/res only) → `service` (logic) → `model` (database queries only) + tests |
| `src/scripts/` | Operator command-line tasks. `<name>.ts` holds the logic (exported and tested), `<name>.cli.ts` is the thin executable, run with `npm run <name>`. Today: `setup-client` (see below) |

**`setup:client`** creates a new client's `client_settings` row and its first Admin, in one transaction. The Admin gets a 16-character temporary password (letters and digits without look-alikes, from `crypto.randomInt`) which the script prints once to the terminal; the database holds only its bcrypt hash and `must_change_password` is set. Two audit rows are written (`client_settings.create`, `user.create`, no actor). It refuses, changing nothing, if any user or settings exist, even when two runs start together (an atomic insert decides the winner). It writes to `DATABASE_URL`, so for staging a variable set in the operator's terminal overrides `.env`; commands are in `docs/dev-setup.md`.

### 5.2 Middleware order (every request)

| # | Middleware | Why here |
|---|---|---|
| 0 | `app.set('trust proxy', TRUST_PROXY)` | `req.ip` is the real client behind Vercel + Render |
| 1 | `pino-http` | First, so even rejected requests are logged; health paths skipped (polled constantly) |
| 2 | `helmet()` | Security headers (HSTS, nosniff, CSP, frame options…); hides `X-Powered-By` |
| 3 | `cors({ origin: CORS_ORIGIN[], credentials: true })` | Explicit allow-list; other origins get no CORS headers |
| 4 | `cookieParser()` | Reads the `ds_session` cookie for `requireAuth` |
| 5 | `express.json({ limit: '1mb' })` | Body parsing with a size cap; only `application/json` bodies are parsed |
| 6 | `/api/v1` routes | Feature modules. Per route, as needed: `requireAuth(db)` → `requirePermission('…')` → `requireBranch` → `validate({ params, query, body })` → controller |
| 7 | `notFound` | Unknown routes → 404 envelope |
| 8 | `errorHandler` | Every error → failure envelope (below) |

**Route guards** (`backend/src/middleware/`, Task 2.4):

| Guard | Does | Fails with |
|---|---|---|
| `requireAuth(db)` | Reads `ds_session`, verifies it (`auth.service.verifySession`), sets `req.ctx = { user, activeBranchId, sessionId, sessionToken }` | 401 `UNAUTHORIZED` / `SESSION_EXPIRED` / `ACCOUNT_DISABLED` |
| `requirePermission(p)` | `can(user.role, p)` from the shared permission map. Without `requireAuth` in front it answers 401 — never "allowed" | 403 `FORBIDDEN` |
| `requireBranch` / `activeBranchId(req)` | The session's active branch, used to filter every branch-owned query. It reads as empty the moment the cashier is unmapped from the branch or the branch is deactivated (checked in the same query as the session) | 403 `NO_ACTIVE_BRANCH` |
| `validate({ params, query, body })` | zod-parses each part and replaces it with the parsed value (coerced numbers, defaults, unknown fields dropped) | 422 `VALIDATION_ERROR`, details `[{ path: 'body.quantity', message }]` |

### 5.3 Error handling

| Thrown | HTTP | `error.code` | Body |
|---|---|---|---|
| `AppError` (business rule) | 400 | specific, e.g. `INSUFFICIENT_STOCK` | message + `details` |
| `ValidationError` / `ZodError` | 422 | `VALIDATION_ERROR` | `details: [{ path, message }]` |
| `AuthError` | 401 | `UNAUTHORIZED` (or specific) | message |
| `ForbiddenError` | 403 | `FORBIDDEN` (or specific) | message |
| `NotFoundError` / unknown route | 404 | `NOT_FOUND` | message |
| malformed JSON body | 400 | `INVALID_JSON` | message |
| body over 1 MB | 413 | `PAYLOAD_TOO_LARGE` | message |
| anything else | 500 | `INTERNAL_ERROR` | generic message only — full error logged server-side, never sent |

Every response uses the envelope: `{ success, data | error, meta: { timestamp, version } }`.

### 5.4 Endpoints today

| Method & path | Touches DB | Used by | Returns |
|---|---|---|---|
| `GET /api/v1/health` | yes (`select 1`, 5 s timeout) | status page, humans | `{ status, uptimeSeconds, database: 'ok'│'down' }` — always 200; a timeout is logged |
| `GET /api/v1/health/live` | **no** | Render health check, keep-awake pings | `{ status, uptimeSeconds }` |
| `POST /api/v1/auth/login` | yes | login screen | `MeResponse` + sets the `ds_session` cookie (httpOnly, SameSite=lax, Path=/, Secure in production, expires with the session) |
| `GET /api/v1/auth/me` | yes | app start, route guards | `MeResponse`: user, permissions, branches, active branch, `needsBranchSelection` |
| `POST /api/v1/auth/select-branch` | yes | branch picker | `MeResponse` |
| `POST /api/v1/auth/change-password` | yes | forced or voluntary change | `MeResponse`; ends the user's other sessions |
| `POST /api/v1/auth/logout` | yes | logout | clears the cookie, deletes the session |

**Login flow details:** an unknown username is still checked against a dummy bcrypt hash, so response time doesn't reveal which usernames exist. Every failure answers `INVALID_CREDENTIALS` and is audited with the attempted username, never the password. Until a temporary password is changed, every route except me / change-password / logout answers 403 `PASSWORD_CHANGE_REQUIRED`. Every login event writes an audit row in the same transaction (D-30).

### 5.5 Configuration

All settings come from `backend/src/config/env.ts` (the only file that reads `process.env`), validated once at startup by `env.schema.ts`. Locally they load from the repo-root `.env`; on Render from its dashboard.

| Variable | Default | Production rule |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `PORT` | `4000` | given by Render (10000) |
| `DATABASE_URL` | **required** | postgres URL |
| `TEST_DATABASE_URL` | optional | not set |
| `CORS_ORIGIN` | `http://localhost:5173` | **required**, comma list, never `*` |
| `SESSION_TTL_HOURS` | `12` | — |
| `COOKIE_SECURE` | `false` | **must be `true`** |
| `LOG_LEVEL` | `info` | — |
| `TRUST_PROXY` | `0` | `2` on staging |

An invalid setting stops the server at startup with a list of variable names — never their values.

### 5.6 Logging

pino writes one JSON line per event. Secrets (`password`, `token`, cookies, `Authorization`, `Set-Cookie`) are redacted; request bodies are never logged. Levels: 5xx → error, 4xx → warn, else info. Business history goes to the audit log (D-30, from Phase 2), not to these logs.

---

## 6. Database layer

| Aspect | How it works |
|---|---|
| Driver / ORM | `pg` connection pool wrapped by Drizzle ORM (`NodePgDatabase`, typed `Db`) |
| Connection security | `connectionConfig()` upgrades `sslmode=require/prefer/verify-ca` to **`verify-full`** (full certificate + hostname check; pg 9 would weaken `require`) and switches on **channel binding** when the URL asks for it (pg ignores it in the URL). Verified live: **TLS 1.3, certificate verified** on all Neon projects |
| Pool sizes | app 10 · tests 20 (concurrency tests) · migrator / `db:check` 1 · 15 s connect timeout (Neon wake-up) |
| Migrations | Schema in `database/src/schema/` → `npm run db:generate -- --name=<what>` writes SQL to `database/migrations/` (read before commit) → `runMigrations(url)` applies pending ones and returns how many were new (0 = up to date; `null` = none generated). `db:migrate` prints "Applied N new migration(s)" or "already up to date". Staging runs it during Render's build |
| Tables (Phase 2) | `client_settings` (single row, `id = 1`), `branches` (code `^[A-Z]{1,3}$`, unique), `users` (username unique ignoring case; role `admin`/`cashier`), `user_branches` (composite key; a branch with mapped users can't be deleted), `sessions` (unique `token_hash`; removed with their user), `audit_logs` (`jsonb` before/after; indexed by entity, time, actor). Migration `0000_access_and_audit` |
| Column conventions | ids: `bigint` identity read as JS numbers · timestamps: `timestamptz` · `updated_at` refreshed by Drizzle on update · rules that protect data (formats, uniqueness, single row) are database constraints, tested with raw SQL in `backend/test/schema/` |
| Checks | `npm run db:check [-- TEST_DATABASE_URL]` prints host/db (never credentials), PostgreSQL version, latency and client-side TLS |
| Migration journal | Drizzle keeps it in the separate `drizzle` schema; app tables live in `public` |

Rules for later phases (stock ledger, row locks, gapless bill numbers, branch scoping, integer paise) are in `AGENTS.md` → Domain invariants.

---

## 7. Frontend

| Aspect | How it works |
|---|---|
| Stack | Vite 8, React 19, Tailwind 4, React Router 7 (`createBrowserRouter`), TanStack Query 5 |
| API client | `src/api/client.ts`: base `/api/v1`, `credentials: 'include'`, unwraps the envelope. Throws `ApiError { code, message, status, details }` — including `NETWORK_ERROR` (server unreachable, status 0) and `BAD_RESPONSE` (non-JSON reply, e.g. Vercel's proxy-timeout page) |
| Labels | Every label via `t('key')` from `src/i18n/en.ts`; keys are typed, so a misspelt key fails the type check; Tamil later is a second dictionary (D-25) |
| Data fetching | TanStack Query, 1 retry (covers a waking free-tier backend) |
| Dev server | port 5173; proxies `/api` → `localhost:4000` |
| Production build | `frontend/dist`: ~348 KB JS (~109 KB gzip) + ~8 KB CSS |
| Screens today | Status page (API + database health, each line coloured by its own state) |

---

## 8. Shared contract

`@ds/shared` holds what both ends must agree on, so a change is one edit and a type error on the other side:

| Export | Meaning |
|---|---|
| `rupeesToPaise`, `formatPaise` | Money as integer paise; Indian digit grouping (`₹1,00,000.00`) |
| `ApiSuccess`, `ApiFailure`, `ApiResponse`, `ApiMeta`, `ApiErrorBody` | The response envelope |
| `HealthStatus`, `LivenessStatus` | Health endpoint data |
| *(Phase 2+)* zod schemas, permission map, billing math | Validation and rules used by both ends |

---

## 9. Security

| Area | As built | Coming |
|---|---|---|
| Transport | HTTPS on Vercel and Render (HSTS sent); TLS 1.3 with verified certificate to Neon; channel binding | — |
| Headers | helmet defaults on every response | — |
| CORS | explicit allow-list; production refuses `*` | — |
| Secrets | `.env` git-ignored and checked before every commit; staging secrets only in Render's dashboard; production config refuses insecure cookies | — |
| Errors | unexpected errors return a generic 500; stack and messages stay in server logs | — |
| Logs | secrets redacted; no request bodies | compact request lines (Task 7.2) |
| Proxies | `trust proxy` configured | real-IP check via audit IPs (Task 2.5) |
| Auth | Login, logout, me, select-branch, change-password (§5.4); bcrypt cost 12, 72-byte limit, timing-safe for unknown usernames; 32-byte tokens stored as SHA-256; httpOnly SameSite=lax cookie; forced password change enforced by the server. Verified: a real login leaves neither password nor token in the logs (cookies show as `[redacted]`) | login rate limit (Task 7.1) |
| Audit | `logAudit` in the same transaction as each change; login, failed login, logout, branch switch, password change (and failed change), and the setup of the client and first Admin are all audited. Redaction hides fields named like password / token / secret / hash, but leaves true/false values visible, so a flag such as `mustChangePassword` still shows what changed (an earlier version hid it; found and fixed in Task 2.7) | every later write (D-30) |
| Branch isolation | `activeBranchId(req)` on every branch-owned query; access ends immediately on unmapping or branch deactivation | — |
| Cross-site request forgery | Three layers: the session cookie is `SameSite=lax`; the API reads only `application/json` bodies, which a foreign site can't send without a CORS preflight; and the preflight is refused for any origin but ours. Tested (`auth.routes.test.ts`: text/plain and form bodies → 422, no cookie; foreign-origin preflight gets no allow-origin) and re-checked on staging through Vercel | one more pass in Task 7.2 |
| Abuse | — | login rate limit (Task 7.1) |

---

## 10. Testing architecture

| Package | Runner | What | Count |
|---|---|---|---|
| shared | Vitest | money helpers | 23 |
| database | Vitest | URL safety, TLS settings, env guard | 12 |
| backend | Vitest + Supertest | env, errors, envelope, logger redaction, error handler, health, liveness, harness | 52 |
| frontend | Vitest (node) | labels, API client | 9 |
| **Total** | | | **96** |

**Backend test harness** (`backend/test/`):

```
globalSetup (once)   → guard: TEST_DATABASE_URL must exist and differ from the dev DB (host+port+name)
                     → wake Neon (3 tries × 5 s) → apply migrations to the test DB
setupFiles (each)    → point DATABASE_URL at TEST_DATABASE_URL before the app loads
tests                → createTestDb() (pool 20) / resetDb() (truncate public tables)
                       both refuse to run outside the harness
```

Backend test files run one at a time (they share one database), with 30 s timeouts for Singapore round trips. A full `npm run verify` takes about 1–2 minutes.

---

## 11. Build and deploy pipeline

```
  local:   edit → npm run verify (lint · format · types · 96 tests) → commit → git push
  GitHub:  main updated
  Vercel:  install + build frontend → atomic switch to the new version   (~30 s)
  Render:  npm ci → build packages + backend → db:migrate → start → health check passes
           → traffic switches → old instance gets SIGTERM                (~1–2 min)
```

- Deploys trigger on every push to `main`; there is no separate release step.
- The quality gate runs **locally** before each commit. Nothing in the pipeline re-runs it yet — see §14.
- Rollback: Render keeps previous deploys (one-click rollback); Vercel can promote an earlier deployment.

---

## 12. Free-tier limits and operations

| Service | Limit | Effect | Handling |
|---|---|---|---|
| **Render** Free | sleeps after **15 idle minutes**; **750 instance-hours/month** per workspace, shared by all free services | first request after sleep 30–60 s, which can exceed Vercel's 30 s proxy limit | reload once; optional keep-awake ping |
| **Neon** Free | sleeps after **5 idle minutes**; **100 CU-hours/month** per project (~400 h awake at 0.25 CU); storage cap | wake-up 1–3 s; over the hours cap the database is **shut off until next month** | let it sleep: Render's health check and the keep-awake ping use `/health/live`, which never touches the database |
| **Vercel** Hobby | non-commercial use only; 30 s proxied-request timeout | — | dev-only staging (D-31); production elsewhere |

**Optional keep-awake job** (user's choice): cron-job.org → `https://dept-store-api-staging.onrender.com/api/v1/health/live`, schedule `*/10 6-23 * * *`, time zone **Asia/Kolkata**. That keeps Render warm 06:00–24:00 IST (~540 h of 750) while Neon sleeps. Pinging every 4–5 minutes through the database would keep Neon awake ~540 h — over its ~400 h allowance. Render staff discourage keep-awake pings on the free tier.

---

## 13. Versions

Pinned exactly in `package-lock.json` (`.npmrc` → `save-exact=true`).

| Area | Version |
|---|---|
| Node.js | 24 LTS (local 24.19.0; Render `NODE_VERSION=24`; Vercel 24.x) |
| npm | 11 |
| PostgreSQL | 18.6 (Neon) |
| TypeScript | **6.0.3** — pinned; 7.x breaks `typescript-eslint` |
| Express / helmet / cors | 5.3.0 / 8.3.0 / 2.8.6 |
| zod | 4.6.5 |
| pino / pino-http | 10.4.0 / 11.0.0 |
| drizzle-orm / drizzle-kit / pg | 0.45.4 / 0.31.11 / 8.23.1 |
| dotenv | 18.0.7 |
| React / React Router / TanStack Query | 19.3.0 / 7.18.4 / 5.104.1 |
| Vite / @vitejs/plugin-react / Tailwind | 8.3.4 / 6.1.2 / 4.3.3 |
| Vitest / Supertest / tsx | 5.0.3 / 7.3.1 / 4.23.15 |
| ESLint / typescript-eslint / Prettier | 10.12.0 / 8.71.1 / 3.9.9 |

---

## 14. Known gaps

| Gap | Impact | Plan |
|---|---|---|
| No CI: the gate isn't re-run on GitHub | a push that skipped `npm run verify` still deploys | Add a GitHub Actions workflow running `npm run verify` on every push (needs the user's OK; uses a test DB secret) |
| Request log lines repeat every response header | noisy Render logs | Compact serializers (Task 7.2) |
| Render's port-detection probe (`HEAD /`) logs a 404 warning on each deploy | cosmetic | Ignore, or answer `/` quietly (Task 7.2) |
| Graceful shutdown not yet observed (Windows can't send SIGTERM) | unverified behaviour | Check Render logs for `Shutting down` on the next deploy |
| **Staging records Cloudflare's address, not the visitor's.** Observed in Task 2.5: all six failed-login audit rows, direct to Render and via Vercel, held Cloudflare addresses (checked against Cloudflare's published ranges), so `TRUST_PROXY=2` is too small | audit IPs are wrong, and a per-IP login limit (Task 7.1) would lump many visitors together by Cloudflare edge | Read the headers of a probe request in Render's logs, set `TRUST_PROXY` to the hop count that reaches the visitor, then re-check with the procedure in `dev-setup.md` §11. Re-verify for every environment (AWS too) |
| A hop count can be spoofed when the origin is reachable directly | anyone calling `…onrender.com` instead of the Vercel address can add `X-Forwarded-For` entries and pick the IP the server records | Accepted on dev-only staging. Production must reach the app only through its front proxy (network rules or a shared secret header), and Task 7.1 also limits failures per username |
| A lost Admin password has no recovery command yet: `setup:client` refuses to run twice | a single Admin who loses the temporary password before first login is locked out (on throwaway databases: rebuild) | `reset-password` script, Task 2.9 |
| Login takes about 2 s on Render Free (median 2.08 s through Vercel, 1.6–2.4 s; ~0.4 s on the dev PC) | slow-feeling login on the free staging CPU (0.1 CPU); bcrypt cost 12 is deliberate | Decide at Checkpoint 2: keep 12 (production hardware will be faster), or make the cost a setting |
| Failed logins store the attempted username in `audit_logs` | someone who types their password into the username box would have it stored | Decide in Task 7.2: keep as is (useful for spotting attacks), or store only a hash for usernames that don't exist |
| `npm audit`: 4 moderate (esbuild inside dev-only drizzle-kit) | none at runtime | Accepted; recheck in Task 7.2; never `npm audit fix --force` |
| Production platform undecided (AWS leaning) | deploy kit and backups (Tasks 7.4–7.5) wait for it | PD-03 |

---

## 15. Keeping this document current

Update this file in the same change whenever any of these change: hosting or service settings, environments or URLs, packages or the build, the middleware order, endpoints, environment variables, the test harness, or pinned versions. Business rules belong in `pending-decisions.md`; build steps in `build-plan/`.
