# Implementation Plan — Department Store v1

Status: Approved 2026-10-10. Phase 1 not started — each phase begins when the user says go.

Business decisions: [pending-decisions.md](pending-decisions.md). Coding rules: root `AGENTS.md`. Out of scope: [future-plans.md](future-plans.md).

## Problem

One client's department store branches need a cloud web app (D-01) for three jobs:
- **Billing** at the counter: fast, keyboard-first, with barcode scanning
- **Purchase entry** for incoming stock from vendors
- **Stock management** with an accurate history of every change

Each new client gets its own copy of the app (D-07).

## Proposed solution

A TypeScript monorepo (D-09): an Express + Drizzle + PostgreSQL API, and a React + Vite frontend, sharing zod schemas through a `shared/` package. Stock is a ledger (D-02); bills and posted purchases are immutable (D-14, D-19).

### Patterns ported from Asthiwar_v1

Port these files from `D:\DreamLand\Projects\Asthiwar\Asthiwar_v1` and adapt them rather than copying them as-is:

| Source | Use here | Change |
|---|---|---|
| `backend/src/middleware/auth.ts` + `modules/auth/` | Session token in an httpOnly cookie, checked against a DB sessions table | Store only the token hash; add active branch to the session |
| `backend/src/middleware/validate.ts` | zod request validation | Return 422 `ValidationError` (DreamLand §8) |
| `backend/src/middleware/errorHandler.ts`, `services/audit.service.ts` | Central error handling and audit log | Redact request bodies before logging (DreamLand §9) |
| `database/src/migrate.ts`, root `package.json` scripts | Migration runner, workspace scripts | Add `test`, `setup:client` |

### Data model (`database/src/schema/`)

Fields marked `?` are nullable.

| Table | Key columns |
|---|---|
| `client_settings` | business name, address, phone, GSTIN? |
| `branches` | code (≤3 letters, unique), name, address, phone, bill footer, is_active |
| `users` | username (unique), password_hash, full_name, role (`admin`/`cashier`), is_active |
| `user_branches` | user_id, branch_id (D-10) |
| `sessions` | token_hash, user_id, active_branch_id?, expires_at |
| `categories` | branch_id, name (unique per branch) |
| `items` | branch_id, code (unique per branch), barcode? (unique per branch), name, category_id?, mrp_paise, selling_price_paise, reorder_level?, hsn_code?, gst_rate?, is_active |
| `item_stock` | item_id (PK), quantity (≥ 0) |
| `stock_movements` | branch_id, item_id, type (`opening`/`purchase`/`purchase_cancel`/`sale`/`sale_cancel`/`adjustment`), quantity (signed), balance_after, ref_type + ref_id, reason?, note?, batch_no?, expiry_date?, created_by, created_at |
| `vendors` | branch_id, name, phone?, gstin?, address?, is_active |
| `purchases` | branch_id, vendor_id, vendor_invoice_no, invoice_date, status (`draft`/`posted`/`cancelled`), total_paise, post/cancel audit fields; unique (branch, vendor, invoice no) |
| `purchase_lines` | purchase_id, item_id, quantity, cost_price_paise, new_mrp_paise?, new_selling_price_paise?, batch_no?, expiry_date? |
| `customers` | phone (unique), name? — client-wide (D-08) |
| `bills` | branch_id, fy, seq, bill_no (unique), cashier_id, customer_id?, subtotal/discount/round_off/total in paise, status (`completed`/`cancelled`), cancel fields; unique (branch, fy, seq) |
| `bill_lines` | bill_id, item_id, item_name + mrp + unit price snapshot, quantity, discount_paise, line_total_paise, hsn_code?, gst_rate?, taxable_paise?, cgst_paise?, sgst_paise?, igst_paise? |
| `bill_payments` | bill_id, mode (`cash`/`upi`/`card`), amount_paise |
| `bill_sequences` | branch_id, fy, last_seq (PK branch + fy) |
| `audit_logs` | actor, action, entity, entity_id, before/after (redacted), created_at |

### API (`/api/v1`)

Every list route takes `?limit&offset`, and every response uses the standard envelope.

| Resource | Endpoints |
|---|---|
| auth | login, logout, me, change-password, select-branch |
| admin | branches, users, user-branch mapping, reset-password, settings, CSV import (items + opening stock), cross-branch reports |
| items, categories | CRUD, search by name, lookup by barcode or code |
| vendors | CRUD |
| purchases | create draft, edit draft, post, cancel, list, get |
| bills | create, list, get, cancel, print data |
| customers | lookup by phone |
| stock | current stock, movement history per item, create adjustment |
| reports | day summary, item-wise sales, stock, low stock, purchase register |

### Bill creation transaction (the critical path)

1. Validate the payload with zod: lines `{itemId, quantity, discountPaise}`, payments `{mode, amountPaise}`, optional customer.
2. `BEGIN`.
3. Lock the `item_stock` rows for all items in ascending `item_id` order.
4. Check that every item has enough stock; otherwise throw `INSUFFICIENT_STOCK` (D-13).
5. Load prices on the server, then compute line totals, discount and round-off (D-17).
6. Check that payments add up to the total (D-16).
7. Allocate the bill number: `INSERT … ON CONFLICT DO UPDATE … RETURNING last_seq` on `bill_sequences` (D-15).
8. Insert the bill, its lines and payments, and post `sale` movements through `stock.service`.
9. `COMMIT`.

## Phases

Task-by-task instructions for each phase, the agent protocol, and progress tracking: [build-plan/README.md](build-plan/README.md).

| Phase | Scope |
|---|---|
| 1 | Scaffold the monorepo (shared, database, backend, frontend), env validation, response and error libraries, logger, health endpoint, Vitest with a test database |
| 2 | Auth, sessions, permissions; Admin screens for branches, users, mapping and settings; `setup:client` script that creates the first Admin |
| 3 | Items, categories, vendors, the stock ledger service, CSV import with opening stock |
| 4 | Purchases: draft, post, cancel |
| 5 | Billing: counter screen (keyboard-first, barcode, split payment), cancel, customer lookup, 80mm receipt print (PD-04) |
| 6 | Stock adjustments, reports (cashier and admin views), i18n dictionary |
| 7 | Hardening: login rate limit, audit review, backup script, deploy notes (needs PD-03) |

## File list (representative)

```
package.json                         workspaces + root scripts
shared/src/schemas/<feature>.ts      zod API contracts
database/src/schema/<table>.ts       Drizzle tables
database/src/migrate.ts, seeds/, scripts/setup-client.ts
backend/src/app.ts, server.ts, config/env.ts
backend/src/lib/{response,errors,branch-scope}.ts
backend/src/middleware/{auth,validate,permissions,errorHandler}.ts
backend/src/modules/<feature>/<feature>.{routes,controller,service,schema,test}.ts
frontend/src/pages/<feature>/, frontend/src/i18n/en.ts
```

## Packages (approved with this plan)

| Workspace | Packages |
|---|---|
| Backend / database | express, helmet, cors, cookie-parser, express-rate-limit, bcrypt, zod, drizzle-orm, drizzle-kit, pg, dotenv, pino, pino-http, csv-parse, tsx, typescript, vitest, supertest |
| Frontend | react, react-dom, react-router-dom, @tanstack/react-query, vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite |
| Repo tooling | eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, prettier |

`@types/*` packages for any approved package count as approved (D-29). The i18n dictionary is a small in-house `t()` function, with no package.

## Verification

- **Every phase:** `npm run check-types` and `npm test` pass for all workspaces. Supertest covers every route against a test Postgres database.
- **Ledger and concurrency tests:**
  - Two simultaneous bills for the last unit: exactly one succeeds, and stock ends at 0.
  - 50 parallel bills produce gapless bill numbers.
  - A purchase whose stock has been sold cannot be cancelled.
  - A bill at 31 March 23:59 IST and one at 1 April 00:01 IST land in different financial-year sequences.
- **Manual (Phase 5):** run both dev servers. Log in as a cashier, scan and type items, complete a split-payment bill, print it, cancel it, then check that stock and the day summary agree.
