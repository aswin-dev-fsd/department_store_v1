# Developer Setup

How to get this project running on a new machine, the everyday commands, and fixes for known problems.

Last updated: 2026-10-10 (Task 1.9)

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | **24 LTS** (D-27; also in `.nvmrc`) | `node -v` |
| npm | 11 or later (comes with Node 24) | `npm -v` |
| git | any recent version | `git --version` |
| PostgreSQL | **18** with pgAdmin 4 (Windows installer from postgresql.org) | `psql --version` |
| Neon account | free plan, for staging and online test runs | [console.neon.tech](https://console.neon.tech) |

Development and tests use a local PostgreSQL (D-33). The Neon projects (D-28) are kept for staging and for running the tests online when asked.

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

You need **two** databases, so tests can never touch your development data:

| Database | Used by | `.env` variable |
|---|---|---|
| `dept_store_dev` (local) | the app while you develop | `DATABASE_URL` |
| `dept_store_test` (local) | the automated tests, which wipe it | `TEST_DATABASE_URL` |

**Create them in pgAdmin 4** (connected to *PostgreSQL 18* as `postgres`):
1. **Login/Group Roles → Create → Login/Group Role…**: Name `dept_store`; Definition → a password of letters and digits only (it goes into a URL); Privileges → **Can login?** on. Save.
2. **Databases → Create → Database…**: `dept_store_dev`, owner `dept_store`. Save. Repeat for `dept_store_test`.

**Online alternative (Neon):** the projects `dept-store-dev` and `dept-store-test` on AWS Singapore, Postgres 18, connection pooling off. Step-by-step: [build-plan/phase-0-preflight.md](build-plan/phase-0-preflight.md), Task 0.2. Keep their URLs in `.env` as commented lines; switching is swapping two lines.

## 4. The `.env` file

Copy `.env.example` to `.env` at the repo root and set the two connection strings, e.g. `postgresql://dept_store:PASSWORD@localhost:5432/dept_store_dev` and `…/dept_store_test` (no `sslmode` locally). Every other variable has a working default for development. `backend/src/config/env.schema.ts` is the source of truth for names, defaults and production rules.

`.env` is git-ignored. Never commit it, and never paste its contents into a chat or an issue.

## 5. Check the setup

```bash
npm run db:check
```

```bash
npm run db:check -- TEST_DATABASE_URL
```

Each should print `✓` and the PostgreSQL version (18.6). Against Neon it also prints `Encryption: TLSv1.3 · certificate verified: yes`; locally there is no encryption, which is fine on your own PC. Then run every check at once:

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

The web app runs on http://localhost:5173 and opens the login screen. The status page at http://localhost:5173/status needs no login and should show **API: ok** and **Database: ok**.

- The frontend forwards `/api/*` to the backend, the same way Vercel does when deployed, so login cookies behave identically everywhere.
- The backend restarts by itself when you edit `backend/src`. Changes to `shared/` or `database/` need a restart of both servers, because those packages are compiled first.
- In Claude Code's desktop app, `.claude/launch.json` starts both servers in the Browser pane.

### Create the first Admin (once per database)

There is no sign-up screen: the first Admin is created by a script. Run it once on each database you want to log in to. It needs the migrations applied first (`npm run db:migrate`).

```bash
npm run setup:client -- --business-name "Demo Stores" --admin-username admin --admin-name "Store Admin"
```

- It writes to `DATABASE_URL` and prints the database it used (host and name) first, so you can see where it ran.
- It prints a **temporary password once**. Write it down: it is stored only as a hash and appears in no log. The Admin must change it at first login.
- Names in Tamil are fine for `--business-name` and `--admin-name`. The username is 3–32 characters: lowercase letters, digits, `.`, `_`, `-`.
- Running it again on the same database refuses ("already set up") and changes nothing.
- `npm run setup:client -- --help` shows the options.

**For staging**, point the script at the staging database for that one command (PowerShell). Take the connection string from Render → `dept-store-api-staging` → Environment. Never put it in `.env` or paste it into a chat.

```powershell
$env:DATABASE_URL = "<staging connection string>"
npm run setup:client -- --business-name "Staging Stores" --admin-username admin --admin-name "Staging Admin"
Remove-Item Env:DATABASE_URL
```

A variable set in the terminal beats the `.env` file, which is why this reaches staging instead of dev.

### Log in

Open http://localhost:5173 and log in with the username and temporary password from `setup:client`. The app first asks for a new password (at least 8 characters), then opens the Admin area. A Cashier goes straight to Billing; a Cashier with several branches picks one first and can switch later from the header. A wrong password shows "Wrong username or password", and a deactivated user sees the same message (the app never says which accounts exist). There is no "forgot password" link: an Admin resets passwords, or use the command below.

### Set up branches and cashiers

Logged in as the Admin, open **Administration**:

1. **Settings**: the business name, address and phone.
2. **Branches**: add each branch. The code (1–3 letters) appears on every bill number, so settle it before the first bill. Deactivating a branch takes it away from the cashiers working in it on their next request.
3. **Users**: add each cashier. A card shows their **temporary password once**, with a Copy button; it cannot be looked up later, so copy it before pressing Done (a second password never replaces one that is still on screen). Then use **Branches** on the cashier's card to tick the branches they may work in: one branch and they go straight to billing, several and they pick one at login.
4. **Reset password** and **Deactivate** ask for confirmation first. Your own row has neither (use "Change password" in the header). Deactivating a user ends their sessions at once.

### Fill a dev database with demo data (optional)

For trying the app by hand without typing in a catalogue. It needs an **empty** database: migrations applied, nothing else (do not run `setup:client` first).

```bash
npm run db:seed
```

- It creates the client settings (a made-up "Demo Department Store"), an Admin (`admin`), two cashiers (`cashier1` works in Tiruppur only; `cashier2` in both branches, so you can try the branch picker), the branches `TPR` and `CBE`, and in each branch 5 categories and 50 items with barcodes, prices and opening stock. A few items are sold out or below their reorder level on purpose, for billing and low-stock tests later.
- It runs the same services as the screens, and the CSV import for the stock, so the accounts, the ledger and the audit rows are the real thing.
- It prints the database it used first, then the three logins (the table below).
- The passwords are **fixed and public**: they are written in `backend/src/scripts/seed-dev.ts` and here. That is fine for a throwaway dev database and nowhere else, so never reuse them. Nobody is asked to change them at the first login, so you can go straight to the screens.
- Running it again says "already seeded" and changes nothing. A database that already has other data (a user, the client settings or a branch) is refused untouched, which includes staging after `setup:client`. It never runs with `NODE_ENV=production`.
- The run is several steps, not one transaction. If it stops half-way, empty the database and run it again.

| Username | Password | Role | Works in |
|---|---|---|---|
| `admin` | `admin@123` | Admin | no branch; picks one on the Stock and Import pages |
| `cashier1` | `cashier1@123` | Cashier | Tiruppur (`TPR`) only |
| `cashier2` | `cashier2@123` | Cashier | `TPR` and Coimbatore (`CBE`); picks one at login |

### Import a branch's items and stock from a CSV file

Logged in as the Admin, open **Administration → Import**. Choose the branch, pick the file, and press **Import into …**. The same page has a link to download the template: replace its two example rows with your items (save your spreadsheet as CSV).

- The whole file is checked first. If any row has a problem, **nothing is imported** and the page lists every problem with its row and column (row 1 is the header, so the first item is row 2).
- Prices are in rupees, like `145.50`, and the selling price cannot be above the MRP. A blank opening stock means 0. A code or barcode may appear only once in the file and must not already exist in the branch, so importing the same file twice is refused.
- When it finishes, the page shows how many items and categories were created and how many items got opening stock. Open **Stock** to check the numbers against your file; **Show history** on an item lists the movement that put its stock there.
- The Admin picks the branch from a drop-down on the Import and Stock pages (active branches only); a cashier's Stock page always shows the branch they work in.

### Reset a password from the command line (recovery)

Admins reset other people's passwords on the Users screen. This command is for when nobody can: for example the only Admin lost the temporary password before their first login (`setup:client` refuses to run twice).

```bash
npm run reset-password -- --username admin
```

- It prints a new **temporary password once**. The user must change it at their next login, and all their current sessions end.
- The username can be typed in any letter case. An unknown username is refused and nothing changes.
- A deactivated account is reset too but still cannot log in; the command says so, and an Admin must reactivate it.
- Like `setup:client`, it writes to `DATABASE_URL`, and prints the database it used first. For staging, set `$env:DATABASE_URL` for that one command in PowerShell, as above.
- `npm run reset-password -- --help` shows the usage.

## 7. Commands

All run from the repo root.

| Command | What it does |
|---|---|
| `npm run dev:backend` | Build the shared packages, then run the API with auto-restart |
| `npm run dev:frontend` | Build the shared packages, then run the Vite dev server |
| `npm run setup:client -- --business-name … --admin-username … --admin-name …` | Create the client settings and the first Admin on a new database (see section 6) |
| `npm run reset-password -- --username …` | Give a user a new temporary password from the command line: recovery when nobody can use the Admin screens (see section 6) |
| `npm run db:seed` | Fill an empty dev database with demo data (two branches, an Admin, two cashiers, 50 items per branch) with fixed dev logins (see section 6) |
| `npm run verify` | **The gate:** lint, format check, type check, all tests. Runs at each checkpoint; nothing is run per task (see `docs/build-plan/README.md` step 6) |
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
- Backend test files run **one at a time** (they share one database). On local PostgreSQL the backend suite (807 tests at Checkpoint 5A) takes about **3 minutes**; against Neon, where every query crosses to Singapore, it took **31 minutes**. Ask for a Neon run when you want to check the online setup: swap the two URLs in `.env`, run `npm test`, swap back.
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
1. In pgAdmin, open **`dept_store_dev`** → Query Tool (or, for Neon, **`dept-store-dev`** → SQL Editor), and run: `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`
2. Run `npm run db:migrate`.
3. Load demo data with `npm run db:seed` (section 6).

## 10. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `npm install <pkg> -w @ds/x` "succeeds" but the package isn't in `x/package.json` | npm 11 quirk with a newly added workspace | Run plain `npm install` once, then repeat the command |
| `Refusing to run tests: TEST_DATABASE_URL points at the same database…` | `.env` uses one database for both | Create the separate test project (section 3) |
| `TEST_DATABASE_URL is not set` | Missing from `.env` | Add it (section 4) |
| `Invalid environment variables:` on start | A missing or invalid `.env` value | The message names each variable; fix it in `.env` |
| Status page shows **Database: down** right after a break | Neon took longer than the 5-second health limit to wake; the backend log says `Database ping timed out` | Wait a few seconds; the page re-checks every 30 seconds |
| `ERROR: This database is already set up` | `setup:client` has run on this database before | Log in with the existing Admin. On a throwaway dev or staging database only, rebuild it (section 9) and run it again |
| Lost the temporary password, or the only Admin is locked out | It is shown only once and stored only as a hash | `npm run reset-password -- --username <name>` (section 6) prints a new one. It works on any database, including a client's real one |
| `ERROR: --admin-username is required` (or similar) | A missing or invalid option | The message names the option; `npm run setup:client -- --help` shows the rules |
| `EADDRINUSE` on port 4000 or 5173 | A previous dev server is still running | Stop it, or close the terminal running it |
| GitHub asks which account to use on every push | More than one GitHub account is saved on this PC | Put the account in the remote: `git remote set-url origin https://aswin-dev-fsd@github.com/aswin-dev-fsd/department_store_v1.git` |
| `npm audit` reports 4 moderate issues | A known esbuild issue inside the dev tool `drizzle-kit`; not used at runtime | Accepted (Task 7.2). Never run `npm audit fix --force`: it downgrades drizzle-kit |

## 11. Staging (dev-only online copy — D-31)

```
Browser → Vercel (web app + /api/* rewrite) → Render, Singapore (API) → Neon, Singapore (staging DB)
```

| Piece | Address | Settings |
|---|---|---|
| Web app | https://dept-store-staging.vercel.app | Vercel project `dept-store-staging` (Hobby, dev-only). Root Directory `frontend` · Install `cd .. && npm ci --include=dev` · Build `cd .. && npm run build:packages && npm run build -w @ds/frontend` · Output `dist` · Node 24.x |
| API | https://dept-store-api-staging.onrender.com | Render Web Service `dept-store-api-staging`, Singapore, Free. Build `npm ci --include=dev && npm run build:packages && npm run build -w @ds/backend && npm run db:migrate` · Start `node backend/dist/server.js` · Health check path `/api/v1/health/live` · Auto-deploy on commit |
| Database | Neon project `dept-store-staging` | AWS Singapore, Postgres 18. Its connection string lives only in Render's environment variables |

**Render environment variables:** `NODE_ENV=production`, `NODE_VERSION=24`, `DATABASE_URL` (secret), `CORS_ORIGIN=https://dept-store-staging.vercel.app`, `COOKIE_SECURE=true`, `SESSION_TTL_HOURS=12`, `LOG_LEVEL=info`, `TRUST_PROXY=4` (verified 2026-10-10; it was 2 at first, which is two hops too few — reasoning and results in `architecture.md` §3.4).

- **Deploys:** every push to `main` redeploys both automatically (Vercel ~30 s, Render ~1–2 min). Migrations run during Render's build.
- **Changing the API address:** edit the rewrite in `frontend/vercel.json` and Render's `CORS_ORIGIN` together.
- **Free-tier sleep:** Render sleeps after 15 idle minutes. The first request then takes 30–60 s and can exceed Vercel's 30 s proxy limit (`ROUTER_EXTERNAL_TARGET_ERROR`); reload once.
- **Optional keep-awake:** cron-job.org → `https://dept-store-api-staging.onrender.com/api/v1/health/live`, schedule `*/10 6-23 * * *`, time zone Asia/Kolkata. It hits the live endpoint, so Neon still sleeps and stays within its free hours.

### Check that the server sees real visitor IPs

`TRUST_PROXY` is the number of proxies between the visitor and the app. If it is too low, the audit log records a proxy's address instead of the visitor's, and a per-IP login limit (Task 7.1) would treat many visitors as one. Check it after any change to the hosting setup and for every new environment:

1. Trigger one failed login. Once the login screen exists (Task 2.10), type a wrong password on the site. Until then, send the request from PowerShell (it should print `expected: Unauthorized`):

```powershell
try { Invoke-RestMethod -Method Post -Uri https://dept-store-staging.vercel.app/api/v1/auth/login -ContentType 'application/json' -Body '{"username":"ip-check","password":"wrong"}' } catch { "expected: " + $_.Exception.Response.StatusCode }
```

2. In that environment's Neon SQL Editor, run:

```sql
select id, ip, after->>'username' as username
from audit_logs where action = 'auth.login_failed' order by id desc limit 5;
```

3. The `ip` must be **your own public IP** (search "what is my IP"). A Cloudflare, Vercel (AWS) or private address means the number is too low. If your connection has both IPv4 and IPv6, the site may have seen either one; both are yours.

On 2026-10-10 this check **failed** on staging: every row held a Cloudflare address, so `TRUST_PROXY=2` was too low. Render's logs showed the whole proxy chain and the fix was 4; after changing it, the check passed (the visitor's own address on every normal request; a made-up `X-Forwarded-For` was ignored through Vercel). The reasoning is in `architecture.md` §3.4. To read a request's full chain yourself: Render → the service → Logs → search for a marker you put in the URL (for example add `?probe=mycheck` to a request that gets rejected); each rejected request is logged with its headers.
