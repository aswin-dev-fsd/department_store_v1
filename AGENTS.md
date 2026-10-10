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
- Done means `npm run verify` passes across all workspaces, every new route has a Supertest test, and code that moves stock or allocates bill numbers has a concurrency test. A test of a protection (permission, uniqueness, audit) is proven by removing the protection once and watching it fail.
