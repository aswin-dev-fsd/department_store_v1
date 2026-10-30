# Architecture

How the system is built and deployed **as it exists today**. For business rules and the plan, see [project-overview.md](project-overview.md); for decisions, [pending-decisions.md](pending-decisions.md).

Last updated: 2026-10-15 · State: end of Phase 3 (access, then the catalog, the stock ledger and the CSV import, with their screens). Purchases, billing and reports arrive from Phase 4 onwards.

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
| `TRUST_PROXY=4` | Four proxy hops sit between a Vercel visitor and Express (Render's local proxy, Render's internal proxy, Cloudflare, Vercel); `req.ip` must come from `X-Forwarded-For` for rate limiting and audit IPs. It was first set to 2, which recorded Cloudflare's address; see §3.4 |

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
| | Env vars | `NODE_ENV=production`, `NODE_VERSION=24`, `DATABASE_URL` *(secret)*, `CORS_ORIGIN=https://dept-store-staging.vercel.app`, `COOKIE_SECURE=true`, `SESSION_TTL_HOURS=12`, `LOG_LEVEL=info`, `TRUST_PROXY=4` *(verified, §3.4)* |
| **Neon** project `dept-store-staging` | Region / version | AWS Singapore / Postgres 18 |
| | Connection | direct (pooling off); string stored only in Render |

`--include=dev` matters: Render applies `NODE_ENV=production` during the build too, and plain `npm ci` would then skip TypeScript and the other build tools.

### 3.4 How the server finds the visitor's IP

Express counts addresses from the app outward and `TRUST_PROXY` says how many to trust; `req.ip` is the first one it doesn't. Render's logs of two probe requests (2026-10-10) show what each proxy adds to `X-Forwarded-For`:

| Position from the app | Via Vercel | Direct to Render |
|---|---|---|
| socket | `::1` (a proxy on Render's own machine) | `::1` |
| 1 | `10.31.197.151` (Render internal) | `10.31.197.151` |
| 2 | `172.70.143.249` (Cloudflare) | `172.68.147.162` (Cloudflare) |
| 3 | `13.233.78.144` (Vercel, AWS Mumbai) | **the visitor** |
| 4 | **the visitor** | |

Running those exact headers through Express's own `proxy-addr`:

| `TRUST_PROXY` | Via Vercel records | Direct to Render records |
|---|---|---|
| 2 (the first setting) | Cloudflare ✗ | Cloudflare ✗ |
| 3 | Vercel's address ✗ | the visitor ✓ |
| **4** | **the visitor ✓** | the visitor ✓ |

The first setting, 2, matches what the staging audit rows showed (all Cloudflare). Staging therefore needs **4**, because real traffic comes through Vercel. The value must be measured again for every environment; the check is in `dev-setup.md` §11.

**Verified on 2026-10-10** with four failed logins after the change to 4 (the `ip` column of their audit rows):

| Test | Recorded |
|---|---|
| via Vercel, normal | the visitor ✓ |
| via Vercel, with a made-up `X-Forwarded-For: 203.0.113.9` | **the visitor** ✓ (Vercel overwrote the made-up header) |
| direct to Render, normal | the visitor ✓ |
| direct to Render, with the made-up header | `203.0.113.9` (spoofed) |

Caveats: a hop count trusts whatever sits that far left, so anyone calling the Render address *directly* can choose the IP recorded, as the last row shows (accepted on dev-only staging; §14). Through Vercel it cannot be spoofed. Vercel also adds an `x-vercel-proxy-signature` header whose purpose I found no documentation for: it is treated as a secret and redacted from logs.

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
| `@ds/shared` | API contract: money helpers (paise), response-envelope types, health types, the zod schemas of every API area, the permission map, the ledger's movement vocabularies | `shared/dist` (tsc, incremental) | backend, frontend |
| `@ds/database` | Drizzle client (`createDb`), TLS/connection settings, migration runner, `db:check` / `db:migrate` / `db:generate` CLIs, the schema (access, catalog and ledger tables) | `database/dist` (tsc, incremental) | backend |
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
| `src/lib/` | Shared helpers: `response` (envelope), `errors` (typed errors), `logger` (pino, secrets redacted), `audit` (`logAudit` + redaction), `changes` (`changedFields`: what really changed, for before/after audit rows), `db-errors` (`isUniqueViolation`, looks through Drizzle's wrapper), `like` (`likePattern`: a search pattern with the LIKE wildcards `%` and `_` escaped), `temporary-password`, `branch-scope` |
| `src/modules/<feature>/` | One folder per feature: `routes` → `controller` (req/res only) → `service` (logic) → `model` (database queries only) + tests. Today: `auth`, `branches`, `categories`, `health`, `import`, `items`, `settings`, `stock`, `users`, `vendors` |
| `src/scripts/` | Operator command-line tasks. `<name>.ts` holds the logic (exported and tested), `<name>.cli.ts` is the thin executable, run with `npm run <name>`; `cli.ts` holds what they share (`out`, `fail`, `CliUsageError`). Today: `setup-client`, `reset-password` and the dev-only `seed-dev` (`npm run db:seed`, see below) |

**`setup:client`** creates a new client's `client_settings` row and its first Admin, in one transaction. The Admin gets a 16-character temporary password (letters and digits without look-alikes, from `crypto.randomInt`) which the script prints once to the terminal; the database holds only its bcrypt hash and `must_change_password` is set. Two audit rows are written (`client_settings.create`, `user.create`, no actor). It refuses, changing nothing, if any user or settings exist, even when two runs start together (an atomic insert decides the winner). It writes to `DATABASE_URL`, so for staging a variable set in the operator's terminal overrides `.env`; commands are in `docs/dev-setup.md`.

**`db:seed`** (Task 3.8) fills an **empty** development database with demo data by calling the real services: `setupClient` (settings and the Admin), `createBranch` (`TPR`, `CBE`), `createUser` and `setUserBranches` (`cashier1` in Tiruppur, `cashier2` in both branches), `changePassword` and the CSV import for each branch (5 categories and 50 items each, EAN-13 barcodes, prices, opening stock through the ledger). Each account's generated temporary password is replaced straight away through `changePassword` by a fixed public dev password, written in `seed-dev.ts` and `docs/dev-setup.md`: it is hashed like any other, each change writes an `auth.password_change` audit row, and no change is forced at login. These passwords exist only in this dev seed; the Users screen, `setup:client` and `reset-password` still make random temporary ones. The seed refuses in production, answers "already seeded" when both branches exist, and refuses a database that holds any other data. It is several transactions, not one: after a half-way stop, empty the database and run it again.

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

The CSV import is the one route that reads a `text/csv` body: `express.text` (5 MB cap) runs inside that route, after login and the permission check, so a file is read only for someone allowed to send it. The route is mounted ahead of the branches routes on the same prefix, so it answers its own path with its own permission (`admin:import`) instead of inheriting `admin:branches`.

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
| body over the route's cap (1 MB; 5 MB for the CSV import) | 413 | `PAYLOAD_TOO_LARGE` | message |
| import body that is not `text/csv` | 415 | `CSV_REQUIRED` | message |
| import file with problems | 422 | `IMPORT_INVALID` | `details: [{ row, column, message }]`, every problem; nothing saved |
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
| `GET /api/v1/admin/branches` | yes | Admin → Branches | `Page<Branch>` ordered by code, active and inactive alike; `?limit=20&offset=0&isActive=true\|false` |
| `POST /api/v1/admin/branches` | yes | Admin → Branches | `Branch` (201). Code 1–3 letters, typed in any case, stored upper-case; a code already in use answers 400 `DUPLICATE_CODE` |
| `PATCH /api/v1/admin/branches/:id` | yes | Admin → Branches | `Branch`. Any fields, or `isActive` to deactivate / reactivate |
| `GET /api/v1/admin/settings` | yes | Admin → Settings | `ClientSettings` (business name, address, phone); 404 `NOT_SET_UP` before `setup:client` has run |
| `PUT /api/v1/admin/settings` | yes | Admin → Settings | `ClientSettings`. Replaces the record: an omitted address or phone is cleared |
| `GET /api/v1/admin/users` | yes | Admin → Users | `Page<UserSummary>` ordered by username (ignoring case), each with its branches; `?limit=20&offset=0&role=&isActive=` |
| `POST /api/v1/admin/users` | yes | Admin → Users | `{ user, temporaryPassword }` (201), the password shown this once. A taken username (any case) answers 400 `DUPLICATE_USERNAME` |
| `PATCH /api/v1/admin/users/:id` | yes | Admin → Users | `UserSummary`. A new `fullName`, or `isActive` to deactivate / reactivate |
| `POST /api/v1/admin/users/:id/reset-password` | yes | Admin → Users | `{ temporaryPassword }`, shown once; ends the user's sessions; they must change it at next login |
| `PUT /api/v1/admin/users/:id/branches` | yes | Admin → Users | `UserSummary`. Replaces the cashier's whole list of branches |
| `POST /api/v1/admin/branches/:id/import` | yes | Admin → Import | `{ categoriesCreated, itemsCreated, openingMovements }` (201). The CSV file is the request body (`Content-Type: text/csv`, up to 5 MB); `admin:import` |
| `GET /api/v1/categories` | yes | Catalog → Categories, drop-downs | `Page<Category>` by name (ignoring case); `stock:read`, active branch |
| `POST /api/v1/categories`, `PATCH /api/v1/categories/:id` | yes | Catalog → Categories | `Category` (201 / 200); `category:write`. A name the branch already uses (any case) answers 400 `DUPLICATE_NAME` |
| `GET /api/v1/items` | yes | Catalog → Items | `Page<Item>` by name, with stock; `?search=&categoryId=&active=&limit&offset` (`active` left out: both); `stock:read` |
| `GET /api/v1/items/lookup` | yes | the counter (Phase 5) | one active `Item` by exact `?barcode=` or `?code=`, else 404; `bill:create` |
| `POST /api/v1/items`, `PATCH /api/v1/items/:id` | yes | Catalog → Items | `Item`; `item:write`. Create inserts the item **and** its stock row (0) in one transaction; `isActive` deactivates or reactivates; 400 `DUPLICATE_CODE` / `DUPLICATE_BARCODE`; a selling price above the MRP is a 422 |
| `GET /api/v1/vendors`, `POST /api/v1/vendors`, `PATCH /api/v1/vendors/:id` | yes | Catalog → Vendors | `Page<Vendor>` (`?search=&active=`) / `Vendor`; all need `vendor:write`. The optional GSTIN must match the 15-character pattern |
| `GET /api/v1/stock` | yes | Stock | `Page<StockLine>` (every item of the branch with its quantity, by name; `?categoryId=`); `stock:read`. A cashier reads their branch; the Admin names it with `?branchId=` |
| `GET /api/v1/stock/:itemId/movements` | yes | Stock → history | `Page<StockMovement>`, newest first, with type, quantity, balance after, reason, note, who and when; same branch rule |

**Login flow details:** an unknown username is still checked against a dummy bcrypt hash, so response time doesn't reveal which usernames exist. Every failure answers `INVALID_CREDENTIALS` and is audited with the attempted username, never the password. Until a temporary password is changed, every route except me / change-password / logout answers 403 `PASSWORD_CHANGE_REQUIRED`. Every login event writes an audit row in the same transaction (D-30).

**Admin routes** (`/admin/*`) need the matching `admin:*` permission; a cashier gets 403. Their conventions apply to every later list and update route:
- **Lists** take `?limit=20&offset=0` (limit 1–100; digits only, so `1e3` or `0x10` are refused) and answer a `Page`: `{ items, total, limit, offset }`.
- **Updates** lock the row, change only the fields that really differ, and write one audit row with just those before/after values. A request that changes nothing writes nothing. Status changes get their own action (`branch.deactivate`, `branch.activate`); other edits are `branch.update`, `client_settings.update`.
- **Duplicates** never surface as a 500: creates use `INSERT … ON CONFLICT DO NOTHING`, and edits translate the database's unique violation into `DUPLICATE_CODE`. Two simultaneous creates of one code give exactly one 201 and one 400.
- **Deactivating a branch** takes effect on the very next request of any cashier working in it (Task 2.4's session check), so it needs no sign-out.
- The settings API leaves the GSTIN out until GST is decided (PD-01). The branch-code lock once a branch has bills arrives in Task 5.6 (`TODO(5.6)` in `branches.service.ts`).

**User management rules** (`users.service.ts`):
- The server makes the temporary password (16 characters) and returns it once, on create and on reset. It is stored only as a bcrypt hash and appears in no audit row or list. The user must change it at first login.
- **Role and username are fixed** once an account exists in v1: to change either, create a new account.
- **You cannot deactivate your own account**, which also guarantees at least one active Admin always remains; nor reset your own password here (use "Change password").
- **Deactivating or resetting ends all the user's sessions in the same transaction.** Deleting them at once matters beyond the next request: otherwise reactivating a user would bring their old sessions back to life (the session check alone would accept them again). Both cases are tested.
- **Branch mapping** (`PUT /:id/branches`) replaces the whole list, for cashiers only. A branch can be *added* only if it exists and is active; one already mapped may stay after being deactivated, so a list can be saved again unchanged. A cashier working in a removed branch loses it on their next request. Audit rows record ids and codes before and after.
- **`reset-password` command** (`npm run reset-password -- --username <name>`) shares its core (`resetUserPassword`) with the API route. It is for when nobody can use the Admin screens, e.g. the only Admin lost the password before first login; it prints the new temporary password once, writes an audit row with no actor, and works for a deactivated account too (with a note).

**Catalog, stock and import rules** (Phase 3):
- **Branch scoping:** categories, items and vendors are read and written through the session's active branch; a record of another branch is a 404, never a leak. The Admin works in no branch, so gets 403 on all of them. Stock reads are the exception: someone holding `report:all` (the Admin) names the branch with `?branchId=` (missing: 422; unknown: 404), while a cashier naming any branch but their own gets 403.
- **Audit:** every create and edit writes one audit row in the same transaction, with before/after for the fields that really changed (`category.create` / `category.update`, `item.create` / `item.update` / `item.activate` / `item.deactivate`, `vendor.*` likewise, `branch.import` with the counts). Names and prices are plain data in these rows; nothing secret is involved.
- **Duplicates** are typed errors, never a 500: categories use an atomic `INSERT … ON CONFLICT DO NOTHING`; items and vendors catch the unique violation and then look at which of code or barcode is taken. Two cashiers adding the same code at once give one 201 and one 400.
- **Money** is whole paise end to end. The shared schemas refuse a selling price above the MRP when both are sent, and the item service compares a single new price with the stored other one.
- **Search** is `ILIKE` with the wildcards escaped (`lib/like`), over the name, code and barcode of items and the name of vendors; lookups by barcode or code are exact.
- **Stock reads** order the movements by row id, newest first: the id is the order the stock lock applied them in, which is the order `balance_after` follows (the clock time is not).
- **CSV import** checks the whole file before it saves anything: header, every row against the shared row schema, the price rule, repeats inside the file, and codes and barcodes the branch already has; every problem is answered at once as `[{ row, column, message }]` (row 1 is the header). A good file is saved in one transaction: missing categories (matched by name in any letter case), items and stock rows in batches of 500 per statement, then one `opening` movement per item with stock through `postMovements`. Two imports at once cannot both win: the loser gets 422 (duplicates) or 400 `IMPORT_CONFLICT`, never a 500.

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
| `TRUST_PROXY` | `0` | `4` on staging (§3.4); measure it for every new environment |

An invalid setting stops the server at startup with a list of variable names — never their values.

### 5.6 Logging

pino writes one JSON line per event. Secrets (`password`, `token`, cookies, `Authorization`, `Set-Cookie`) are redacted; request bodies are never logged. Levels: 5xx → error, 4xx → warn, else info. Business history goes to the audit log (D-30, from Phase 2), not to these logs.

### 5.7 The stock ledger service

`stock.service.postMovements(tx, { branchId, userId, movements })` is the **only** code that changes `item_stock` (Task 3.2); the import calls it for opening stock, and later purchases, bills and adjustments will. It never opens a transaction: the caller passes its own, so a stock change commits or rolls back with the document behind it.

- It locks the stock rows of the items involved with one statement, `SELECT … ORDER BY item_id FOR UPDATE OF item_stock`, joined to `items` so that an item of another branch (or none) is simply not returned and answers 404. One ordered statement means two callers needing overlapping items queue in the same order and cannot deadlock.
- It walks the movements in order, tracking each item's running balance and its lowest point, and throws `INSUFFICIENT_STOCK` (listing every short item) **before writing anything**. Then it writes all the quantities in one `UPDATE … FROM (VALUES …)` and all the ledger rows in one `INSERT`. Each row records `balance_after`, so the history reads as a running total.
- The invariant, checked by the tests after every scenario: an item's stock equals the sum of its ledger rows, and each row's `balance_after` equals the running total up to it. The concurrency tests (two counters selling the last unit; opposite orders of the same two items) were run ten times in a row when the service was built.
- Reads (`GET /stock`, the history) live in the same module but never write.

---

## 6. Database layer

| Aspect | How it works |
|---|---|
| Driver / ORM | `pg` connection pool wrapped by Drizzle ORM (`NodePgDatabase`, typed `Db`) |
| Connection security | `connectionConfig()` upgrades `sslmode=require/prefer/verify-ca` to **`verify-full`** (full certificate + hostname check; pg 9 would weaken `require`) and switches on **channel binding** when the URL asks for it (pg ignores it in the URL). Verified live: **TLS 1.3, certificate verified** on all Neon projects |
| Pool sizes | app 10 · tests 20 (concurrency tests) · migrator / `db:check` 1 · 15 s connect timeout (Neon wake-up) |
| Migrations | Schema in `database/src/schema/` → `npm run db:generate -- --name=<what>` writes SQL to `database/migrations/` (read before commit) → `runMigrations(url)` applies pending ones and returns how many were new (0 = up to date; `null` = none generated). `db:migrate` prints "Applied N new migration(s)" or "already up to date". Staging runs it during Render's build |
| Tables (Phase 2) | `client_settings` (single row, `id = 1`), `branches` (code `^[A-Z]{1,3}$`, unique), `users` (username unique ignoring case; role `admin`/`cashier`), `user_branches` (composite key; a branch with mapped users can't be deleted), `sessions` (unique `token_hash`; removed with their user), `audit_logs` (`jsonb` before/after; indexed by entity, time, actor). Migration `0000_access_and_audit` |
| Tables (Phase 3) | `categories` (name unique per branch, ignoring case), `items` (code unique per branch; barcode unique per branch when present; prices as `bigint` paise; `hsn_code` and `gst_rate numeric(5,2)` stay empty until PD-01), `item_stock` (primary key `item_id`; `CHECK (quantity >= 0)`), `vendors`, `stock_movements` (append-only ledger: signed `quantity` with `CHECK (quantity <> 0)`, `balance_after`, enums `movement_type`, `movement_ref_type`, `adjustment_reason`; `batch_no` and `expiry_date` stay empty until PD-02; indexed by `(item_id, created_at)`). Quantities are `integer`. Every foreign key is `RESTRICT`: nothing is ever deleted, only deactivated. Not enforced in SQL (the service layer does it): that an item's category, and a movement's item, belong to the same branch |
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
| Error text | `src/api/errors.ts` `errorMessage()`: the dictionary text for the error code (`error.<CODE>` in `en.ts`), else the server's own wording for a 4xx refusal, else a generic line. A 5xx never shows server wording |
| Labels | Every label via `t('key')` from `src/i18n/en.ts`; keys are typed, so a misspelt key fails the type check (`isMessageKey` checks keys built at runtime, e.g. from an error code); Tamil later is a second dictionary (D-25) |
| Forms | `src/forms/fieldErrors.ts`: `validateForm(schema, values)` runs the same zod schema from `@ds/shared` that the server applies (first message per field); `serverFieldErrors` maps a 422's `body.field` details onto fields. The frontend does not depend on zod directly |
| Data fetching | TanStack Query. One retry only when the server was unreachable or failed (a waking free-tier backend, a proxy timeout), never for a 401/403/404/422; mutations are never retried (`auth/session.ts` `shouldRetry`) |
| Routing | `/status` is public. Everything else sits behind `AuthGate`, which waits for "who am I" and then follows `auth/routing.ts` `requiredRoute`, the only place that decides where a visitor must be (table below) |
| Who is logged in | One query, `['me']` (`auth/queries.ts`): the `/auth/me` reply, or `null` when nobody is (a 401 `UNAUTHORIZED` is an answer, not an error). The session cookie is httpOnly, so page scripts never see it. Re-checked when the window regains focus (30 s freshness), so a deactivation or branch change shows within seconds of coming back |
| Session rules, once for every call | `auth/queryClient.ts`: a 401 `UNAUTHORIZED`/`SESSION_EXPIRED`/`ACCOUNT_DISABLED` from any call ends the session and shows the reason on the login page; a 403 `NO_ACTIVE_BRANCH`/`PASSWORD_CHANGE_REQUIRED`/`BRANCH_NOT_ASSIGNED` reloads `me`; a wrong password (401 `INVALID_CREDENTIALS`) and a wrong current password (400) do not log anyone out |
| Cached data | `auth/cache.ts`: login, logout, a branch switch and any "nobody is logged in" answer remove everything cached for the previous user or branch, so one person's data never shows for the next |
| Permissions in the UI | Nav links and `RequirePermission` read `me.permissions` from the server (the same map the API enforces), never a role name. This is courtesy: the API checks every call itself |
| Accessibility | 44 px controls; every input has a label and is linked to its hint and error; errors are `role="alert"`, confirmations `role="status"`; inputs stay focusable (read-only, not disabled) while a request is sent, so keyboard users keep their place, and a second Enter during the request is ignored |
| Dev server | port 5173; proxies `/api` → `localhost:4000` |
| Production build | `frontend/dist`: ~482 KB JS (~146 KB gzip) + ~15 KB CSS after Task 2.11 (454 KB after the login screens, 348 KB before them) |

**Where a visitor is sent** (`requiredRoute`, in this order):

| Situation | Result |
|---|---|
| Logged out, opened a link to a page | `/login?next=<that page>`; after login they return to it (same-site paths only; absolute URLs, `//host`, backslashes and control characters are refused) |
| Logged out right after being logged in during this visit (logout, ended session) | a plain `/login` with no `next`: on a shared counter PC the next person may be a different role and starts from their own home (found in Task 2.10 testing: an Admin was sent to a cashier's last page) |
| Password change due | `/change-password`, and nothing else is reachable |
| Cashier without a usable active branch | `/select-branch` (with several branches: choose; with none: told to ask the Admin) or `/change-password` |
| Logged in, on `/login` or `/` | `next` if safe, else the role home: `/admin` for admin permissions, `/billing` for `bill:create`, else `/no-access` |
| `/select-branch` with fewer than two branches | the role home (nothing to choose) |

**Screens today:**

| Path | Screen | Notes |
|---|---|---|
| `/status` | Status page | API and database health, each line coloured by its own state; no login needed |
| `/login` | Login | Message for a wrong password; a notice when a session ended on its own; the password box is cleared after a failure |
| `/change-password` | Change password | Forced (with a notice, no cancel) after a first login or reset; otherwise from the header, confirming in place. A "show passwords" box helps with the long temporary passwords |
| `/select-branch` | Branch picker | Marks the current branch; reached from the header to switch |
| `/admin` | Admin hub | A card for each section the person may open |
| `/admin/branches` | Branches | List (20 per page), add, edit, deactivate (asks first), reactivate |
| `/admin/users` | Users | List with each user's branches; add; edit name; branch checklist for cashiers; reset password; deactivate (asks first) and reactivate. A new or reset temporary password appears once in a card with Copy and Done |
| `/admin/settings` | Settings | Business name, address, phone |
| `/admin/import` | Import | The Admin chooses a branch and a CSV file; the counts on success, a Row / Column / Problem table when the file has problems; a template to download (`public/import-template.csv`) |
| `/catalog` | Catalog | Opens the first of Items, Categories and Vendors that the person may use |
| `/catalog/items` | Items | Search by name, code or barcode (on Enter or Search), category filter, status filter (Active only by default); add, edit, deactivate (asks first), reactivate. Prices are typed in rupees |
| `/catalog/categories` | Categories | List, add, rename |
| `/catalog/vendors` | Vendors | Search by name, status filter; add, edit, deactivate (asks first), reactivate |
| `/stock` | Stock | The number in stock per item (cashier: their branch, with a category filter; Admin: chooses the branch), a Low stock badge, and **Show history** for the movement table |
| `/billing` | Billing | Placeholder until Phase 5 |
| `/no-access` | No access | Shown when the role lacks the page's permission |

**Admin screens** (Task 2.11)

| Aspect | How it works |
|---|---|
| Structure | `AdminLayout` shows links to the sections the person may open (and "No access" if none). The sections are listed once in `admin/sections.ts` (address, permission, label); the hub, the links and the routes are all built from that list, and each section route also checks its own permission. The API checks every call regardless |
| Data | `admin/queries.ts`: lists keep the previous page on screen while the next loads. `admin/mutations.ts`: each mutation is a plain options object built from the QueryClient, so tests run it without React, and each refreshes what it makes stale (a branch change also refreshes the user lists, which show branches). Keys live in `admin/keys.ts`, all under `['admin', …]`, so logging out clears them |
| One-time passwords | `TemporaryPassword` shows a created or reset password until the Admin presses Done. Several can be on screen at once, so a second never replaces one that was not copied. The mutations that carry a password use `gcTime: 0`, so the cache drops the reply as soon as no screen is looking at it; the page holds it in state only while it is shown. If the browser refuses the clipboard, the card says so and the password can be selected by hand |
| Safeguards | Your own row has no Deactivate or Reset (the server refuses them too). Deactivate and Reset password ask inline first, with Cancel focused. The branch code stays editable, with a hint that it appears on bill numbers (Task 5.6 will lock it once bills exist) |
| Errors | `describeFailure` puts `DUPLICATE_CODE` and `DUPLICATE_USERNAME` next to their fields, server validation next to its fields, and anything else as one message |
| Limits | Lists page at 20. The branch checklist loads up to 100 active branches. No search or filters yet (`architecture.md` §14) |

**Catalog, stock and import screens** (Tasks 3.9–3.10)

| Aspect | How it works |
|---|---|
| Structure | The same split as the Admin area. `catalog/` holds the data layer (`keys`, `queries`, `mutations`, `filters` with the API paths, `forms`, `sections`); `stock/` holds `paths`, `keys`, `queries` and `display`; `admin/import.ts` the import call. `CatalogLayout` shows links to the sections the person may open; the header has one **Catalog** link (permission `item:write`) and a **Stock** link (`stock:read`) |
| Keys and refreshing | Keys start with `catalog` or `stock`, so logging out or switching branch clears them. An item change refreshes the item lists; a category change refreshes the category lists and drop-downs; an import refreshes stock, items and categories |
| The item form | Prices are typed in rupees and converted with `rupeesToPaise`, then checked by the same shared schemas the server applies (selling price at or below the MRP). Text that is not an amount, or a reorder level that is not a whole number, gets its own plain message. The API names the prices `mrpPaise` / `sellingPricePaise`, so errors are renamed to the form's `mrp` / `sellingPrice` fields. `DUPLICATE_CODE` / `DUPLICATE_BARCODE` land next to their fields |
| Search | Runs when asked (Enter or the Search button), not per keystroke, so a slow connection is not asked a question per letter. A new search or filter starts again from page 1 |
| Stock | `StockPage` reads `me.permissions`: with `report:all` (the Admin) it shows a branch drop-down of active branches and passes `?branchId=`; otherwise the cashier's own branch. The categories API cannot be asked about another branch, so the Admin sees no category filter or names (§14). Movement times are shown in Indian time (`lib/dates.ts`) whatever the computer's timezone |
| Import | `api.postCsv` sends the file's text as `text/csv` (the client otherwise sends JSON). A refused import's `details` are read by `importProblems` into the problems table; any other failure shows one message. The server's problem messages are shown as written (English), not through the dictionary |
| Limits | Lists page at 20; the category drop-downs load up to 100 categories; the Admin's branch drop-downs list active branches only |

**Worth knowing**
- A deactivated user sees "Wrong username or password" at login: the server gives the same reply for a wrong password, an unknown username and an inactive account, so the app never reveals which accounts exist. The Admin tells them.
- A visitor who isn't logged in makes one `GET /auth/me` that answers 401; the browser console lists it as a red network line. That is expected.
- After 6 seconds on the loading screen the app adds "Still connecting… the server may be waking up", for a sleeping free-tier backend.

---

## 8. Shared contract

`@ds/shared` holds what both ends must agree on, so a change is one edit and a type error on the other side:

| Export | Meaning |
|---|---|
| `rupeesToPaise`, `formatPaise` | Money as integer paise; Indian digit grouping (`₹1,00,000.00`) |
| `ApiSuccess`, `ApiFailure`, `ApiResponse`, `ApiMeta`, `ApiErrorBody` | The response envelope |
| `HealthStatus`, `LivenessStatus` | Health endpoint data |
| `PERMISSIONS`, `ROLE_PERMISSIONS`, `can` | The role → permission map (a backend test checks the roles match the database enum) |
| zod schemas and types for auth, branches, users, settings, categories, items, vendors, stock and the CSV import | Validation shared by the server and the forms. Includes `paginationSchema` / `Page<T>`, the query-string pieces `searchTextSchema` and `activeFilterSchema`, and the item price rule (`SELLING_ABOVE_MRP_MESSAGE`) |
| `MOVEMENT_TYPES`, `MOVEMENT_REF_TYPES`, `ADJUSTMENT_REASONS` | The ledger's vocabularies (a backend test checks they equal the database enums) |
| *(Phase 4+)* billing math | Totals, discounts, round-off |

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
| Branch isolation | `activeBranchId(req)` on every branch-owned query; access ends immediately on unmapping or branch deactivation. Catalog and stock queries filter by branch, so another branch's record is a 404. The one cross-branch read, stock, is open only to `report:all` and needs the branch named | — |
| Cross-site request forgery | Three layers: the session cookie is `SameSite=lax`; the API reads only `application/json` bodies, which a foreign site can't send without a CORS preflight; and the preflight is refused for any origin but ours. Tested (`auth.routes.test.ts`: text/plain and form bodies → 422, no cookie; foreign-origin preflight gets no allow-origin) and re-checked on staging through Vercel | one more pass in Task 7.2 |
| Abuse | — | login rate limit (Task 7.1) |

---

## 10. Testing architecture

| Package | Runner | What | Count |
|---|---|---|---|
| shared | Vitest | money helpers, permission map, zod schemas (access, catalog, stock, import, purchases) | 322 |
| database | Vitest | URL safety, TLS settings, env guard | 12 |
| backend | Vitest + Supertest | env, errors, envelope, logger redaction, middleware, auth and sessions, audit, admin APIs, the catalog, vendor, stock, import and purchase APIs (drafts, posting with its concurrency test, cancelling), the stock ledger service with its concurrency tests, operator scripts and the dev seed, schema constraints of the access, catalog, ledger and purchase tables (against the Neon test database, about 10 min) | 670 |
| frontend | Vitest (node) | labels, API client, routing rules, session rules, cache clearing, error text, form checks, Admin and catalog data hooks, paging, branch checklist, admin and catalog sections, stock display rules, the import call, clipboard, the purchase editor's conversions and data hooks | 242 |
| **Total** | | | **1,246** |

**Backend test harness** (`backend/test/`):

```
globalSetup (once)   → guard: TEST_DATABASE_URL must exist and differ from the dev DB (host+port+name)
                     → wake Neon (3 tries × 5 s) → apply migrations to the test DB
setupFiles (each)    → point DATABASE_URL at TEST_DATABASE_URL before the app loads
tests                → createTestDb() (pool 20) / resetDb() (truncate public tables)
                       both refuse to run outside the harness
```

Backend test files run one at a time (they share one database), with 30 s timeouts for Singapore round trips. A full `npm run verify` takes about 12 minutes, almost all of it the backend suite; that is why nothing is run per task and the gate runs at each checkpoint (`build-plan/README.md`, step 6).

---

## 11. Build and deploy pipeline

```
  local:   edit → commit → git push   (npm run verify runs at each checkpoint, not per task)
  GitHub:  main updated
  Vercel:  install + build frontend → atomic switch to the new version   (~30 s)
  Render:  npm ci → build packages + backend → db:migrate → start → health check passes
           → traffic switches → old instance gets SIGTERM                (~1–2 min)
```

- Deploys trigger on every push to `main`; there is no separate release step.
- The quality gate (`npm run verify`) runs **locally**, at each checkpoint (end of a phase). Since 2026-10-15 nothing is run per task, so code pushed between checkpoints is deployed to staging unchecked. Nothing in the pipeline re-runs the gate — see §14.
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
| csv-parse | 7.0.3 (the CSV import) |
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
| A hop count can be spoofed when the origin is reachable directly (confirmed: a made-up `X-Forwarded-For` sent straight to Render was recorded; through Vercel it is overwritten) | anyone calling `…onrender.com` instead of the Vercel address can pick the IP the server records | Accepted on dev-only staging. Production must reach the app only through its front proxy (network rules or a shared secret header), and Task 7.1 also limits failures per username. `TRUST_PROXY` must be measured again for every environment (AWS too): `dev-setup.md` §11 |
| Login takes about 2 s on Render Free (median 2.08 s through Vercel, 1.6–2.4 s; ~0.4 s on the dev PC) | slow-feeling login on the free staging CPU (0.1 CPU); bcrypt cost 12 is deliberate | Decide at Checkpoint 2: keep 12 (production hardware will be faster), or make the cost a setting |
| Failed logins store the attempted username in `audit_logs` | someone who types their password into the username box would have it stored | Decide in Task 7.2: keep as is (useful for spotting attacks), or store only a hash for usernames that don't exist |
| `npm audit`: 4 moderate (esbuild inside dev-only drizzle-kit) | none at runtime | Accepted; recheck in Task 7.2; never `npm audit fix --force` |
| Screens (pages, shell, route guard) have no automated tests; only the logic behind them does (routing, session rules, cache, error text, form checks) | a broken screen, as opposed to broken logic, is caught only by the manual browser check done in each task | Component tests need extra packages (Testing Library and a DOM environment, or Playwright), which need approval. Revisit before the billing screen (Phase 5), where the cost of a UI regression is highest |
| Field messages from the `@ds/shared` schemas ("Enter the username", …) are English text, not `t()` keys | forms would still show English field errors once the Tamil dictionary exists (FP-07) | When FP-07 starts, make the schemas return message keys and translate them in the frontend |
| The Admin's branch and user lists have no search or filters (the catalog lists do), and the cashier branch checklist shows at most 100 active branches | a store with many staff pages through users 20 at a time; more than 100 branches would hide some in the checklist | Add search and a role/status filter when a client needs them (the API already filters users by role and status); the 100-branch limit is far beyond a department store chain |
| The Admin's stock list has no category filter and no category names | the categories API cannot be asked about another branch, so the screen has nothing to filter or label with | A small API change: the category name in each stock row, or `?branchId=` on categories |
| The Admin's branch drop-downs (Stock, Import) list active branches only | a deactivated branch's stock cannot be viewed, nor can a file be imported into it | Include inactive branches there when a client needs it |
| The CSV import's speed is measured only for 1,000 rows | a file near the 5 MB cap (tens of thousands of rows) needs proportionally more database round trips and could approach Vercel's 30 s proxy limit | Measure on staging with a large catalogue before go-live; split the file if needed |
| The import's problem messages are the server's English text, and the catalog and stock screens show other server text only through the dictionary | not translatable once Tamil exists (FP-07) | Return message keys with the problems when FP-07 starts |
| Since 2026-10-15 nothing is run per task, so tasks pushed between checkpoints deploy to staging unchecked | a broken task can reach staging until the next checkpoint | Accepted for speed; the first gap (a GitHub Actions run of the gate on every push, not waited for) would catch it |
| npm warns on every install that the install scripts of `bcrypt` and `esbuild` are not on its `allowScripts` list | none today: bcrypt's prebuilt binary loads and esbuild uses its platform package (the auth tests pass from a clean install) | Review with `npm approve-scripts` if npm starts enforcing the list |
| The frontend bundle is 550 kB (161 kB gzipped; 524 kB at Checkpoint 3), over Vite's 500 kB chunk warning | every `npm run build` prints the warning; nothing breaks, but the first page load grows with each phase | Split by route with `React.lazy` when the size starts to matter (the billing screen is the large one still to come); raise the limit only knowingly |
| Production platform undecided (AWS leaning) | deploy kit and backups (Tasks 7.4–7.5) wait for it | PD-03 |

---

## 15. Keeping this document current

Update this file in the same change whenever any of these change: hosting or service settings, environments or URLs, packages or the build, the middleware order, endpoints, environment variables, the test harness, or pinned versions. Business rules belong in `pending-decisions.md`; build steps in `build-plan/`.
