# AGENTS.md — Department Store v1

Project rules for this repo. They sit on top of `D:\DreamLand\AGENTS.md`; where the two differ, this file wins. Every DreamLand rule not overridden below still applies.

## Overrides of the DreamLand rules

| DreamLand rule | In this project |
|---|---|
| §0 Backend only | Full-stack: build the backend and the React frontend. |
| §3 Locked stack | TypeScript everywhere (6.0.x, pinned at the root — 7.x breaks `typescript-eslint`) · Express · PostgreSQL via Drizzle ORM · zod · Vitest + Supertest · React + Vite + Tailwind · npm workspaces monorepo. |
| §4 Folder structure | Feature modules (see Layout). Controller/service/model roles from §4 still apply inside each module. |
| §5 JSDoc `@param`/`@returns` | One-line TSDoc summary on every exported function; TypeScript carries the types. |
| §5 Jest | Vitest; Supertest for routes. |
| §7 `shared/utils/response.js` | `backend/src/lib/response.ts` |
| §8 `shared/utils/errors.js` | `backend/src/lib/errors.ts` — same classes and status codes, plus `ForbiddenError` (403) for permission checks; a zod failure becomes `ValidationError` (422). |
| §11 `src/config/env.js` | `backend/src/config/env.ts`, validated with zod at startup. |

## Parallel sessions (from 2026-10-30)

Two agent sessions work on this repo at the same time. Each must know which one it is, and stay in its own lane.

| Session | Works on | Folder | Branch |
|---|---|---|---|
| **A** (the first chat) | Checkpoint 4, then Phase 5 (billing) | `D:\DreamLand\Projects\Department_Store\department_store_v1` | `main` |
| **B** (the second chat) | Phase 6 (adjustments and reports) | `D:\DreamLand\Projects\Department_Store\department_store_v1-phase6` (a git worktree) | `phase-6` |

If you don't know which session you are, ask the user before editing anything.

**Session B starts by making its own worktree**, never by working in session A's folder:
`git -C D:\DreamLand\Projects\Department_Store\department_store_v1 worktree add ..\department_store_v1-phase6 -b phase-6`. Then it runs `npm ci` there and copies the root `.env` into it. It never prints that file.

**Rules for both sessions:**
- **Your own folder only.** Never edit, stage or commit files in the other session's folder. Never run `git add -A` outside your own folder. Never `git stash`, reset, rebase or check out in the other folder.
- **Your own phase only.** Edit only the files your phase's tasks name, plus their tests and the usual registration files.
- **Shared files** (`docs/build-plan/progress.md`, `frontend/src/i18n/en.ts`, `shared/src/index.ts`, `backend/src/routes.ts`, `frontend/src/App.tsx`, `frontend/src/components/AppShell.tsx`, `shared/src/permissions.ts`, `docs/project-overview.md`, `docs/architecture.md`): add your own lines and change nothing else. In `progress.md`, touch only your own phase's rows and your own checkpoint summary.
- **Pushes:**
  - Session A pushes to `main` as before, and every push deploys staging.
  - Session B pushes only to `origin/phase-6`. It never pushes to `main` and never merges `phase-6` into `main`. That merge happens only when the user says so, after rebasing `phase-6` on `main` and running the full gate.
  - Session B rebases `phase-6` on `origin/main` whenever it needs Phase 5's work, and before every merge request.
- **Migrations:** only session A creates migrations while both run (Phase 5 adds the billing tables). Phase 6 is planned without one. If session B finds it needs a migration, it stops and asks the user, so two migrations never take the same number.
- **Dependencies on Phase 5:**
  - Tasks 6.2, 6.3, 6.6 (the parts that read bills) and 6.8 need Phase 5's bill tables and Task 5.2's `businessDate`.
  - Session B marks them BLOCKED (protocol step 2) until those tasks are DONE on `origin/main` and `phase-6` has been rebased onto it.
  - Session B can do 6.1, 6.4, 6.5 and 6.7 now.
- **One database user at a time.**
  - The backend tests empty every table of the shared TEST database (`resetDb`), so two test runs at once break each other.
  - Before running backend tests, sabotage proofs, a migration or `db:seed` against any shared database (test, dev or staging), ask the user whether the other session is doing the same. Run only after a yes.
- **Dev servers:** session A uses the ports in `.claude/launch.json` (4000, 5173). Session B asks the user before starting a server, so the two don't fight over the ports.
- **Packages:** ask the user before `npm install` of anything new. Both sessions share one `package-lock.json` through the merge, so a package added on one branch must be merged with care.

## Read before you work

- **`docs/build-plan/README.md`** — before any build task: the agent protocol. `docs/build-plan/progress.md` names the next task.
- **`docs/pending-decisions.md`** — before touching GST, batch/expiry, receipt printing, hosting, or any business rule. Build Decided rows as written; leave Pending items unbuilt.
- **`docs/future-plans.md`** — before adding a feature. Anything listed there is outside v1.
- **`docs/implementation_plan.md`** — the current phase, its scope, and the data model.
- **`docs/project-overview.md`** — orientation: workflows, API map, glossary.
- **`docs/architecture.md`** — before touching hosting, deploy settings, packages, middleware order or env vars: the system as built. Update it in the same change.

## Layout

```
shared/      zod schemas + TS types: the API contract used by backend and frontend
database/    Drizzle schema, migrations, the database client
backend/
  src/modules/<feature>/<feature>.{routes,controller,service,model,schema,test}.ts
             model = database queries only, named as actions (insertX, findX); rules live in the service
  src/lib/   response, errors, audit, temporary passwords, branch-scoped query helper
  src/scripts/ operator CLIs (setup-client, reset-password, later the dev seed): <name>.ts holds
             the logic (exported, tested); <name>.cli.ts is the thin executable; cli.ts holds what
             they share. A generated credential is printed once to stdout and never logged or stored
frontend/    React + Vite app
docs/        decisions, plans, future plans
```

A feature's routes, controller, service, schema and tests live together in its module folder.

## Domain invariants

These protect money and stock. Every change keeps them true.

**Stock ledger**
- Stock changes only through `stock.service` → `postMovement(tx, …)`, which inserts the `stock_movements` row and updates `item_stock` in the same transaction.
- Lock `item_stock` rows with `SELECT … FOR UPDATE` in ascending `item_id` order.
- Stock stays ≥ 0. A movement that would take it below zero throws `AppError` with code `INSUFFICIENT_STOCK` — for sales, purchase cancels and adjustments alike.

**Immutable documents**
- Saved bills and posted purchases are immutable. A correction is a cancel (reason required, reversing movements) followed by a new document.
- Purchases are editable only while in `draft`.
- Bill lines snapshot the item name and prices at the time of sale.

**Branch-scoped data**
- Items, categories, vendors, stock, purchases and bills each belong to one branch. Query them through the branch-scoped helper with the session's active branch.
- Customers, users and client settings are client-wide.

**Money**
- Money is integer paise (`bigint`, mode `number`); quantities are integers. Convert to rupees only for display.
- The server computes every price, discount, round-off and total. Clients send item IDs, quantities and line discounts.

**Bill numbers**
- Format and reset rule: D-15 in `docs/pending-decisions.md`.
- Allocate inside the bill transaction from `bill_sequences` (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), so numbers stay gapless under concurrent counters. Cancelled bills keep their number.

**Audit (D-30)** — every write service (create, edit, delete, status change) calls `logAudit(tx, …)` inside the same transaction, with before/after values. So do login success and failure, logout and password changes. Reads are not audited.

**Time** — store `timestamptz` in UTC; compute the business date and financial year in `Asia/Kolkata`.

**Permissions** — routes check a permission such as `requirePermission('bill:create')`. The role → permission map lives in one file, so adding a role is a map entry plus a seed row.

**Client-neutral code** — each client runs its own copy and database. Store names, addresses, branch codes and bill text come from `client_settings` and `branches`.

**Pending-feature columns** — `batch_no`, `expiry_date`, `hsn_code`, `gst_rate` and the bill-line tax columns stay nullable and unused until their decision moves to Decided.

**UI text** — every label goes through `t('key')` from the dictionary file (English now, Tamil-ready).

## Workflow

- Plan first per DreamLand §1; plans live in `docs/`.
- When the user settles a decision in chat, update `docs/pending-decisions.md` (and `docs/future-plans.md` if scope moves) in the same change, then the matching section of `docs/project-overview.md`.
- Database tests get their connection from `createTestDb()` and clean up with `resetDb()` (`backend/test/helpers/db.ts`). Both refuse to run outside the harness, which points `DATABASE_URL` at `TEST_DATABASE_URL`.
- Test data comes from `backend/test/helpers/fixtures.ts` (`createUser`, `createBranch`, `mapUser`, `createClientSettings`, `cookieFor`), not hand-written INSERTs. Every write test asserts its audit row with `expectAudit`.
- List routes validate with `paginationSchema` and answer a `Page<T>`. Update services lock the row, write and audit only the fields that really changed (`changedFields`), and skip a no-op. A duplicate is a typed error (`INSERT … ON CONFLICT DO NOTHING`, or `isUniqueViolation`), never a 500.
- Done means the task's tests are written (nothing is run per task; the full `npm run verify` across all workspaces runs at each checkpoint), every new route has a Supertest test, and code that moves stock or allocates bill numbers has a concurrency test. A test of a protection (permission, uniqueness, audit) is proven at the checkpoint by removing the protection once and watching it fail.
