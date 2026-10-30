# Department Store v1 — Project Overview

The complete picture of the project in one place: what it does, how it is built, what has been decided, and the build plan.

Last updated: 2026-10-10 · Status: planning complete, Phase 1 not started.

Items marked **(proposed)** are design details not yet confirmed by the client. They are finalised in the build phase named next to them.

## Contents

1. [Summary](#1-summary)
2. [Documents and source of truth](#2-documents-and-source-of-truth)
3. [Users and roles](#3-users-and-roles)
4. [Architecture](#4-architecture)
5. [Data model](#5-data-model)
6. [Business rules](#6-business-rules)
7. [Key workflows](#7-key-workflows)
8. [API reference (planned)](#8-api-reference-planned)
9. [Decisions summary](#9-decisions-summary)
10. [Future plans summary](#10-future-plans-summary)
11. [Build plan](#11-build-plan)
12. [Testing strategy](#12-testing-strategy)
13. [Operations and go-live](#13-operations-and-go-live)
14. [Risks and open items](#14-risks-and-open-items)
15. [Glossary](#15-glossary)
16. [Keeping this document current](#16-keeping-this-document-current)

---

## 1. Summary

**What it is:** a cloud web app for one client's department-store branches. It covers three jobs:

| Module | What it does |
|---|---|
| **Billing** (sales entry) | The cashier scans or searches items, takes payment (cash, UPI, card, or a mix), and prints a receipt. |
| **Purchase entry** | Records stock arriving from vendors against the vendor's invoice. |
| **Stock management** | Tracks the current quantity of every item in every branch, with a full history of every change. |

**Who uses it:** cashiers at the billing counters, and an admin who sets up branches and users and views reports.

**How it runs:** a website hosted in the cloud and opened in a browser at the counter (D-01). Each client gets their own copy of the app and their own database (D-07).

### Scope of v1

| In v1 | Not in v1 (see Future Plans) |
|---|---|
| Billing with barcode, item code and name search | Online booking for customers (FP-01) |
| Split payments: cash, UPI, card | Sales and purchase returns (FP-02) |
| Line discounts and round-off | Owner role (FP-03) |
| Bill cancellation with reason | Copying items between branches (FP-04) |
| Purchase entry: draft → post → cancel | Stock-take screen (FP-05) |
| Stock ledger and stock adjustments | Vendor dues and payments (FP-06) |
| Several branches, several counters | Tamil language (FP-07) |
| Admin: branches, users, settings, CSV import | GST calculation (PD-01 pending; columns ready) |
| Four reports | Batch/expiry tracking (PD-02 pending; columns ready) |

---

## 2. Documents and source of truth

This overview gathers everything in one place. Each topic still has **one authoritative file**. If this overview and that file disagree, the authoritative file wins and this overview gets fixed.

| Topic | Authoritative file |
|---|---|
| Business decisions (D-xx) and pending decisions (PD-xx) | [pending-decisions.md](pending-decisions.md) |
| Features planned after v1 (FP-xx) | [future-plans.md](future-plans.md) |
| Build phases, data model, API, packages | [implementation_plan.md](implementation_plan.md) |
| Step-by-step build tasks and progress | [build-plan/README.md](build-plan/README.md), [build-plan/progress.md](build-plan/progress.md) |
| Architecture **as built**: environments, deployment, request flow, packages, versions | [architecture.md](architecture.md) |
| Setting up a machine, commands, troubleshooting | [dev-setup.md](dev-setup.md) |
| Coding rules for developers and AI agents | `AGENTS.md` (project root), on top of `D:\DreamLand\AGENTS.md` |
| This overview | `docs/project-overview.md` |

---

## 3. Users and roles

### Roles in v1 (D-04)

| Role | Who | Does |
|---|---|---|
| **Cashier** | Counter staff | Billing, bill cancellation, purchase entry, items, categories, vendors, stock adjustments. Works inside the branch they are logged in to. |
| **Admin** | The person who sets up the system; the owner may use this login until the Owner role exists | Branches, users, cashier–branch mapping, password resets, client settings, CSV import, all reports across branches. Does not bill. |
| **Owner** *(later, FP-03)* | Store owner | Takes over all reports. Bill cancellations and stock adjustments become Owner-only. |

### Permission matrix

Code checks **permissions**, not role names. Adding a role means adding a row to the role → permission map plus a seed row; there's no schema change.

In code: `shared/src/permissions.ts`. Its test copies this table cell by cell, so **change this table and the test together** — the test fails until the code agrees.

| Permission | Cashier | Admin | Notes |
|---|:-:|:-:|---|
| `bill:create` | ✓ | | |
| `bill:read` | ✓ | | Own branch: lookups and reprints |
| `bill:cancel` | ✓ | | Moves to Owner with FP-03 |
| `purchase:write` (create and edit drafts) | ✓ | | |
| `purchase:post` | ✓ | | |
| `purchase:cancel` | ✓ | | |
| `item:write`, `category:write` | ✓ | | |
| `vendor:write` | ✓ | | |
| `stock:read` | ✓ | ✓ | Cashier: own branch. Admin: all branches |
| `stock:adjust` | ✓ | | Moves to Owner with FP-03 |
| `report:own-day-summary` | ✓ | | The cashier's own totals only |
| `report:all` | | ✓ | All four reports, all branches |
| `admin:branches`, `admin:users`, `admin:settings`, `admin:import` | | ✓ | |

### Cashier ↔ branch mapping (D-10)

- The Admin assigns each cashier to **one or more** branches.
- One branch: after login, the cashier goes straight into that branch.
- Several branches: after login, the cashier picks a branch. They can switch later with "select branch".
- Everything a cashier sees and does is limited to their **active branch**.

### Account lifecycle

1. **First Admin:** created by the `setup:client` script when a client's copy is installed.
2. **Admin creates cashiers** (Admin → Users) and maps them to branches. The temporary password appears once on screen, with a Copy button; the Admin gives it to the person.
3. **Password reset:** done by the Admin. The user must change the temporary password at next login **(proposed, Phase 2)**.
4. **Leaving staff:** the Admin deactivates the account. Their sessions end immediately, and their past bills keep their name.

---

## 4. Architecture

> This section is the original design. What is actually built and deployed — environments, the Vercel + Render staging topology, middleware order, versions — is in **[architecture.md](architecture.md)**, which wins where the two differ.

### 4.1 System diagram

```
  Branch counter PCs (Chrome)            Admin (any browser)
  + barcode scanner + receipt printer          │
              │ HTTPS                          │ HTTPS
              └───────────────┬────────────────┘
                              ▼
               ┌──────────────────────────────┐
               │ Nginx — TLS, serves frontend │   hosting: PD-03
               └──────────────┬───────────────┘
                              │ /api/v1/*
                              ▼
               ┌──────────────────────────────┐
               │ Express API (Node.js, PM2)   │
               │ auth · permissions · branch  │
               │ scoping · services · ledger  │
               └──────────────┬───────────────┘
                              │ Drizzle ORM (pg driver)
                              ▼
               ┌──────────────────────────────┐
               │ PostgreSQL — one per client  │
               │ + daily off-server backups   │
               └──────────────────────────────┘
```

- **Barcode scanners** act as keyboards in the browser, so they need no special software.
- **Receipts** print from the browser using an 80mm layout (PD-04).

### 4.2 Deployment model

- **One client = one deployment = one database** (D-07). A new client gets a fresh copy of the app, its own `.env`, its own database, and the `setup:client` script.
- **Branches live inside one deployment.** Branch-owned data carries a `branch_id`.
- **No client details in code.** The business name, branch names and codes, addresses, and bill footer come from the `client_settings` and `branches` tables.

### 4.3 Tech stack (D-09)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (backend, frontend, shared) | One set of types for API data on both ends, so a field mismatch is a compile error |
| Runtime | Node.js 24 LTS (D-27) | Standard for Express |
| API framework | Express | Same as previous DreamLand projects |
| Database | PostgreSQL | Transactions and row locks keep stock and bill numbers correct under concurrent counters |
| Data access | Drizzle ORM + drizzle-kit migrations | Type-safe queries; still supports `SELECT … FOR UPDATE` and raw SQL when needed |
| Validation | zod | The same schemas validate requests on the server and forms in the browser |
| Auth | bcrypt passwords + DB sessions in an httpOnly cookie | Sessions can be ended instantly (logout, deactivation) |
| Logging | pino, pino-http | Structured logs; replaces `console.log` |
| Tests | Vitest + Supertest | Native TypeScript; the same runner as Vite |
| Frontend | React + Vite + Tailwind, React Router, TanStack Query | Fast single-page billing screen with no page reloads |
| Process manager | PM2 | DreamLand standard for production |
| Monorepo | npm workspaces | Same layout as Asthiwar_v1 |

### 4.4 Repository layout

```
department_store_v1/
├── AGENTS.md                 coding rules for developers and AI agents
├── package.json              npm workspaces + root scripts
├── docs/                     decisions, plans, this overview
├── shared/                   zod schemas + TS types: the API contract
│   └── src/schemas/<feature>.ts
├── database/                 Drizzle schema, migrations, seeds, scripts
│   └── src/
│       ├── schema/<table>.ts
│       ├── migrate.ts
│       ├── seeds/
│       └── scripts/setup-client.ts
├── backend/
│   └── src/
│       ├── app.ts, server.ts
│       ├── config/env.ts               env vars, validated at startup
│       ├── lib/                        response.ts, errors.ts, branch-scope.ts
│       ├── middleware/                 auth, permissions, validate, errorHandler
│       └── modules/<feature>/          one folder per feature:
│           ├── <feature>.routes.ts       routes only
│           ├── <feature>.controller.ts   req/res only, no logic
│           ├── <feature>.service.ts      business rules, transactions
│           ├── <feature>.schema.ts       zod schemas (re-exported from shared)
│           └── <feature>.test.ts         unit + Supertest tests
└── frontend/
    └── src/
        ├── pages/<feature>/
        ├── components/
        ├── api/                        typed API client
        └── i18n/en.ts                  every UI label (Tamil-ready)
```

Backend feature modules: `auth`, `admin`, `branches`, `users`, `items`, `categories`, `vendors`, `purchases`, `bills`, `customers`, `stock`, `reports`, `health`.

### 4.5 Request lifecycle (backend)

```
Request
  → helmet (security headers), CORS (allow-list from env), JSON body size limit
  → pino-http access log (method, path, status, time — never request bodies)
  → rate limiter (strict on /auth/login)
  → cookie-parser → auth: session cookie → user + active branch     (401 if missing/expired)
  → requirePermission('bill:create')                                (403 if not allowed)
  → validate: zod schema on body/query/params                       (422 if invalid)
  → controller: reads req, calls service, sends response
  → service: business rules, opens DB transaction when needed
  → data access: Drizzle queries through the branch-scoped helper
  → response envelope: { success: true, data, meta: { timestamp, version } }

Any error → errorHandler → { success: false, error: { code, message, details? }, meta }
            (500s log the full stack server-side and return a generic message)
```

### 4.6 Frontend screens

| Screen | Used by | Purpose |
|---|---|---|
| Login | All | Username + password |
| Branch picker | Cashiers mapped to several branches | Choose the active branch |
| **Billing (counter)** | Cashier | Create bills; the main screen |
| Bills | Cashier | Find a bill, view, reprint, cancel |
| Purchases | Cashier | List; draft editor; post; cancel |
| Items and categories | Cashier | Add and edit items, prices, barcodes, reorder levels (Catalog → Items, Categories; built in Phase 3) |
| Vendors | Cashier | Add and edit vendors (Catalog → Vendors; built in Phase 3) |
| Stock | Cashier, Admin | Current stock; movement history per item (built in Phase 3; the Admin chooses the branch) |
| Stock adjustment | Cashier | +/− quantity with a reason |
| Reports | Cashier (limited), Admin (all) | See [6.10](#610-reports-d-22) |
| Admin: Branches, Users and mapping, Settings | Admin | Setup (built in Phase 2). A new or reset temporary password appears once, with a Copy button |
| Admin: CSV import | Admin | Items and opening stock per branch (Phase 3; Administration → Import) |
| Change password | All | Forced at first login and after a reset |
| No access | All | Shown when the role lacks the page's permission |
| Status | Anyone, no login | API and database health (`/status`) |

**Billing screen behaviour (proposed, Phase 5):**
- The cursor starts in one scan/search box.
- A barcode scan, or an item code + Enter, adds the item. Scanning the same item again adds 1 to its quantity.
- Typing letters shows name-search results to pick from with the arrow keys.
- Quantity and line discount are editable per line. The running total is always visible.
- **Pay** opens the payment panel: amounts for cash / UPI / card, and the change due for cash.
- **Save** saves the bill and prints the receipt, then the screen is ready for the next customer.

### 4.7 Security

| Area | Measure |
|---|---|
| Passwords | bcrypt-hashed; never stored or logged in plain text |
| Sessions | Random token in an httpOnly, Secure, SameSite cookie; only its hash is stored in the DB; expires after a set time **(proposed: 12 hours, configurable)**; deleted on logout or deactivation |
| Access | Every route checks permission; every branch-owned query is limited to the session's active branch |
| Database | Parameterized queries only (Drizzle) |
| Transport | HTTPS only; helmet headers; CORS allow-list (never `*`) |
| Login abuse | Strict rate limit on login (Phase 7) |
| Logs | No request bodies; secrets redacted |
| Audit log (D-30) | Every change (create, edit, delete, status change) plus login success and failure, logout and password changes: who, when, branch, what, before/after. Written in the same transaction as the change; viewing data is not logged |

### 4.8 Configuration (`.env.example`) — (proposed, Phase 1)

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` / `test` / `production` |
| `PORT` | API port |
| `DATABASE_URL` | PostgreSQL connection for this client |
| `TEST_DATABASE_URL` | Separate database for automated tests |
| `CORS_ORIGIN` | Allowed frontend origin(s) |
| `SESSION_TTL_HOURS` | Session lifetime |
| `COOKIE_SECURE` | `true` in production (HTTPS) |
| `LOG_LEVEL` | pino log level |

All variables are read and validated once in `backend/src/config/env.ts`. Other code imports from there.

---

## 5. Data model

### 5.1 Relationship map

```
client_settings (one row per deployment)

users ──< user_branches >── branches
users ──< sessions (active_branch → branches)

branches ──< categories ──< items ──── item_stock (1:1, current quantity)
branches ──< vendors
branches ──< purchases ──< purchase_lines >── items
                └── vendor
branches ──< bills ──< bill_lines >── items
               ├──< bill_payments
               └──> customers (optional; client-wide)
branches ──< bill_sequences (one row per financial year)
branches ──< stock_movements >── items      (ref → bill / purchase / adjustment / import)

audit_logs (append-only record of sensitive actions)

  ──<  one-to-many        >──  many-to-one
```

### 5.2 Tables

Every table has `id` and `created_at`; editable tables also have `updated_at`. Fields marked `?` are nullable. Money columns end in `_paise`.

#### Setup and access

| Table | Columns | Rules |
|---|---|---|
| `client_settings` | business_name, address?, phone?, gstin? | Exactly one row. Shown on bills and screens. |
| `branches` | code, name, address, phone?, bill_footer?, is_active | `code`: up to 3 capital letters, unique, printed in bill numbers. Fixed once the branch has bills **(proposed)**. |
| `users` | username, password_hash, full_name, role (`admin`/`cashier`), is_active, last_login_at? | `username` unique. Deactivate, never delete. |
| `user_branches` | user_id, branch_id | Unique pair. Cashiers only; the Admin is not tied to branches. |
| `sessions` | token_hash, user_id, active_branch_id?, expires_at, last_seen_at | Deleted on logout or deactivation. |

#### Catalog

| Table | Columns | Rules |
|---|---|---|
| `categories` | branch_id, name | Unique name per branch (D-23). |
| `items` | branch_id, code, barcode?, name, category_id?, mrp_paise, selling_price_paise, reorder_level?, hsn_code?, gst_rate?, is_active | `code` unique per branch; `barcode` unique per branch when present (D-11). Name includes the size, e.g. "Rice 10 kg" (D-03). Deactivate, never delete. `hsn_code`/`gst_rate` unused until PD-01. |
| `item_stock` | item_id (primary key), quantity | `quantity ≥ 0` enforced by a database CHECK. Always equals the sum of the item's ledger rows. |
| `vendors` | branch_id, name, phone?, gstin?, address?, is_active | Per branch (D-08). |
| `customers` | phone, name? | Client-wide; `phone` unique (10 digits, normalised) (D-08, D-18). |

#### Documents

| Table | Columns | Rules |
|---|---|---|
| `purchases` | branch_id, vendor_id, vendor_invoice_no, invoice_date, status (`draft`/`posted`/`cancelled`), total_paise, notes?, created_by, posted_by?, posted_at?, cancelled_by?, cancelled_at?, cancel_reason? | The same vendor invoice can't be entered twice in a branch unless the earlier one was cancelled (partial unique index). Editable only in `draft` (D-19). |
| `purchase_lines` | purchase_id, item_id, quantity, cost_price_paise, new_mrp_paise?, new_selling_price_paise?, batch_no?, expiry_date?, line_total_paise | `quantity > 0`. New prices, if given, update the item when the purchase is posted (D-12). |
| `bills` | branch_id, fy, seq, bill_no, bill_date, cashier_id, customer_id?, subtotal_paise, discount_paise, round_off_paise, total_paise, taxable_paise?, tax_paise?, status (`completed`/`cancelled`), cancelled_by?, cancelled_at?, cancel_reason? | `bill_no` unique; (branch_id, fy, seq) unique. `bill_date` is the IST business date. Immutable except for cancellation (D-14). |
| `bill_lines` | bill_id, line_no, item_id, item_name, item_code, mrp_paise, unit_price_paise, quantity, discount_paise, line_total_paise, hsn_code?, gst_rate?, taxable_paise?, cgst_paise?, sgst_paise?, igst_paise? | Name and prices are a **snapshot** at sale time, so old bills never change when an item is edited. |
| `bill_payments` | bill_id, mode (`cash`/`upi`/`card`), amount_paise | `amount > 0`; payments add up to the bill total (D-16). |
| `bill_sequences` | branch_id, fy, last_seq | Primary key (branch_id, fy). Source of gapless bill numbers (D-15). |

#### Ledger and audit (append-only: rows are never edited or deleted)

| Table | Columns | Rules |
|---|---|---|
| `stock_movements` | branch_id, item_id, type, quantity, balance_after, ref_type (`bill`/`purchase`/`adjustment`/`import`), ref_id?, reason?, note?, batch_no?, expiry_date?, created_by, created_at | `quantity` is signed: + in, − out. Types: `opening`, `purchase`, `purchase_cancel`, `sale`, `sale_cancel`, `adjustment` (returns are added later with FP-02). |
| `audit_logs` | actor_id?, branch_id?, action, entity, entity_id?, before?, after?, ip?, created_at | One row per change and per login event (D-30). `actor_id` is empty for failed logins. `before`/`after` are redacted JSON snapshots. Indexed by entity and by time. |

### 5.3 The stock ledger, explained (D-02)

Stock is never typed in directly. Every change is a **movement** row in `stock_movements`, and `item_stock.quantity` is kept equal to the running total. Both are written in the **same database transaction**, so they can never disagree.

Example: item "Rice 10 kg" at branch TPR.

| # | When | Event | Type | Qty | Balance after |
|---|---|---|---|---:|---:|
| 1 | Go-live | CSV import | `opening` | +10 | 10 |
| 2 | 12 Oct | Purchase posted (vendor invoice INV-2231) | `purchase` | +24 | 34 |
| 3 | 12 Oct | Bill TPR/26-27/000045 | `sale` | −2 | 32 |
| 4 | 12 Oct | Bill TPR/26-27/000045 cancelled | `sale_cancel` | +2 | 34 |
| 5 | 13 Oct | Adjustment — damage (bag torn) | `adjustment` | −1 | 33 |

`item_stock.quantity` = 33 = 10 + 24 − 2 + 2 − 1.

What the ledger gives you:
- **Answers "why is stock wrong?"** Every unit has a who/when/why.
- **Safe for several counters.** The item's `item_stock` row is locked while it changes, so two counters can't sell the same last unit.
- **Ready for later features.** Returns (FP-02) and stock-take (FP-05) become new movement types, with no redesign.

### 5.4 Money, quantities and time

| Topic | Rule |
|---|---|
| Money | Stored and calculated as **integer paise** (₹1 = 100 paise). Never floating point. Shown as rupees only on screen and in print. |
| Quantity | Whole numbers only (D-03). |
| Timestamps | Stored as `timestamptz` (UTC). |
| Business date | The calendar date in India time (Asia/Kolkata). A bill at 11:30 PM IST belongs to that IST date. |
| Financial year | 1 April – 31 March, IST. April 2026 – March 2027 is `26-27`. |

---

## 6. Business rules

### 6.1 Items and prices
- Each pack size is a separate item: "Rice 5 kg" and "Rice 10 kg" are two items (D-03).
- One current MRP and one selling price per item. All stock sells at the current price (D-12).
- Selling price must not exceed MRP **(proposed validation, Phase 3 — selling above MRP isn't allowed in India)**.
- Items are deactivated, never deleted, because bills and the ledger refer to them.

### 6.2 Billing
- **Insufficient stock blocks the bill** (D-13). The cashier sees which item is short and how many are available. The fix is to enter the purchase first.
- The server computes all prices and totals. The browser sends only item IDs, quantities, and line discounts.
- A saved bill is **locked** (D-14).

### 6.3 Bill numbers (D-15)
- Format: `<BRANCH CODE>/<FY>/<6-digit number>`, e.g. `TPR/26-27/000123`, at most 16 characters (a GST requirement).
- Each branch has its own sequence. It restarts at `000001` on 1 April (IST) every year.
- Gapless: numbers are allocated inside the bill's transaction, so a failed save never uses up a number.
- Cancelled bills keep their number and show as **Cancelled**.

### 6.4 Discounts and round-off (D-17)
- Discount is an **amount per line**; the screen may accept a % and convert it **(proposed, Phase 5)**.
- A line discount can't exceed that line's amount.
- No whole-bill discount in v1.
- The total is rounded to the **nearest rupee**; exactly 50 paise rounds up **(proposed)**. The round-off is stored as its own signed amount.

Worked example:

| Line | Item | Qty | Price | Line discount | Line total |
|---|---|---:|---:|---:|---:|
| 1 | Rice 10 kg | 1 | ₹650.00 | ₹20.00 | ₹630.00 |
| 2 | Sunflower Oil 1 L | 2 | ₹145.50 | — | ₹291.00 |
| 3 | Bath Soap 100 g | 3 | ₹38.25 | — | ₹114.75 |
| | **Subtotal** (before discount) | | | | ₹1,055.75 |
| | **Discount** | | | | −₹20.00 |
| | **Round-off** | | | | +₹0.25 |
| | **Total** | | | | **₹1,036.00** |

Payment: Cash ₹500 + UPI ₹536 = ₹1,036 ✓

### 6.5 Payments (D-16)
- Modes: cash, UPI, card. One bill can be split across modes.
- No payment gateway: the UPI QR and card machine stay separate, and the cashier records the mode.
- The recorded payments must add up exactly to the total. If the customer hands over more cash, the screen shows the change due, and only the bill amount is recorded.

### 6.6 Bill cancellation (D-14)
- Reason required. Records who and when.
- Stock goes back through `sale_cancel` movements.
- Cancelled bills are left out of sales totals and listed separately in the day summary.
- Refunding the money happens outside the system: the cashier hands back the cash or reverses the UPI/card payment.

### 6.7 Purchases (D-19)
- **Draft:** can be saved part-way and edited freely, with no stock effect. Useful when a long vendor invoice is interrupted by customers.
- **Post:** adds stock (`purchase` movements), applies any new MRP or selling price to the items, and locks the purchase.
- **Cancel** (posted only, reason required): removes the stock (`purchase_cancel`). It's blocked if any of that stock has already been sold, because stock would go negative. Fix with an adjustment instead.
- The same vendor invoice number can't be entered twice for the same vendor in a branch, unless the earlier one was cancelled.
- Cost price is recorded per line. What the store owes vendors isn't tracked in v1 (D-26, FP-06).

### 6.8 Stock adjustments (D-20)
- +/− quantity with a required reason: **damage, expiry, theft, count correction, other** (other needs a note).
- Stock can't go below zero.
- Recorded in the ledger and the audit log.

### 6.9 Customers (D-18)
- Optional. Entering a phone number finds the customer or creates a new one. Name is optional.
- Customers are shared across all branches of the client (D-08) — ready for online booking (FP-01).

### 6.10 Reports (D-22)

| Report | Contents | Cashier | Admin |
|---|---|:-:|:-:|
| **Day sales summary** | For a date: bill count, subtotal, discounts, round-off, net total, totals per payment mode, cancelled bills (count and value, kept out of totals); per cashier and per branch | Own totals only | All cashiers, all branches |
| **Item-wise sales** | For a date range: quantity and value sold per item (cancelled bills excluded) | | ✓ |
| **Stock + low stock** | Current quantity per item (filter by category), movement history per item, and items at or below their reorder level | Own branch | All branches |
| **Purchase register** | Posted purchases in a date range by vendor: invoice number, date, total; cancelled ones listed separately | | ✓ |

---

## 7. Key workflows

### 7.1 Go-live for a new client
1. Create the server and database (PD-03), copy the app, and fill in `.env`.
2. Run migrations, then `setup:client`. This creates `client_settings` and the first Admin.
3. The Admin logs in, then enters client settings and creates branches (code, name, address, bill footer).
4. The Admin creates cashier accounts and maps them to branches.
5. The Admin imports each branch's items and opening stock from CSV (D-24). Each opening quantity becomes an `opening` ledger row.
6. Check the stock report against the shelves, then test-print a receipt (PD-04).
7. Complete the go-live checklist ([13.3](#133-go-live-checklist)).

**CSV import format (proposed, Phase 3):** `code, barcode, name, category, mrp, selling_price, reorder_level, opening_stock`. Prices are written in rupees (e.g. `145.50`) and converted to paise. The import checks every row first and shows all errors. It saves only if the whole file is valid **(proposed)**.

*As built (Task 3.7):* the header must name all eight columns, in any order and letter case; other columns are ignored. `code` and `name` are required. `barcode`, `category`, `reorder_level` and `opening_stock` may be blank: a blank stock is 0, and only an item with stock above 0 gets an `opening` ledger row. A selling price above the MRP, a code or barcode repeated in the file or already in the branch, and a row with more values than the header (an unquoted comma) are errors. Categories are matched by name in any letter case, and created when missing. Rows are numbered as in a spreadsheet: the header is row 1.

### 7.2 Login and branch selection
1. Enter username and password.
2. A session cookie is set.
3. A first login, or the first login after a password reset, must choose a new password before anything else is reachable.
4. A cashier with one branch goes straight to Billing. A cashier with several branches picks one (and can switch later from the header). A cashier with no branch is told to ask the Admin. The Admin goes to the Admin home.
5. Every screen afterwards works in the active branch.
6. A link to a page, opened while logged out, returns to that page after login. Logging out, or losing the session, goes to a plain login page, so the next person on a shared counter PC starts from their own home.

### 7.3 Billing a customer
1. Scan or search items. The lines appear with the running total.
2. Adjust quantities and line discounts. Optionally, enter the customer's phone.
3. Press Pay and enter amounts per mode.
4. Save. The server then does all of this in **one transaction**:
   1. Validate the request.
   2. Lock the `item_stock` rows for the bill's items (in item-ID order).
   3. Check stock. If anything is short, reject with `INSUFFICIENT_STOCK` and nothing is saved.
   4. Load current prices and compute line totals, discount, round-off and total.
   5. Check that payments equal the total.
   6. Take the next bill number from `bill_sequences`.
   7. Insert the bill, its lines and payments, and post `sale` movements.
   8. Commit.
5. The receipt prints, and the screen resets for the next customer.

### 7.4 Cancelling a bill
1. Find the bill by number, date, or customer phone.
2. Cancel, entering a reason.
3. Stock comes back (`sale_cancel`), and the bill shows **Cancelled**.
4. If the sale should go through with corrections, create a new bill.

### 7.5 Purchase entry
1. Create a draft: vendor, vendor invoice number, invoice date.
2. Add lines: item, quantity, cost price, and optionally a new MRP or selling price. Save at any time.
3. Post. Stock is added, prices are updated, and the purchase is locked.
4. If it was wrong: cancel it (only possible if none of that stock has been sold), then enter a new purchase.

### 7.6 Stock adjustment
1. Choose the item and enter +/− quantity.
2. Choose a reason (and a note for "other"), then save.
3. A ledger row and an audit row are written.

### 7.7 Day-end close
1. Each cashier opens their **day sales summary**.
2. They count the cash drawer and compare it with the summary's cash total, and compare UPI and card totals with the payment apps and machine.
3. The Admin sees every cashier and branch in the same report.

v1 doesn't record the opening cash float or shortages. The report is the reference.

### 7.8 Adding a new branch
1. The Admin creates the branch (code, name, address).
2. The Admin maps cashiers to it.
3. The Admin imports the branch's items and opening stock from CSV. Copying from another branch is FP-04.

---

## 8. API reference (planned)

### Conventions
- **Base path:** `/api/v1`
- **List routes:** take `?limit=20&offset=0`
- **Success:** `{ "success": true, "data": …, "meta": { "timestamp", "version" } }`
- **Error:** `{ "success": false, "error": { "code", "message", "details?" }, "meta": … }`
- **Auth:** the session cookie is required on every route except `/health` and `/auth/login`.

### Endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/health` | — | Uptime check |
| POST | `/auth/login` | — | Log in, set the session cookie |
| POST | `/auth/logout` | logged in | End the session |
| GET | `/auth/me` | logged in | Current user, role, branches, active branch |
| POST | `/auth/change-password` | logged in | Change own password |
| POST | `/auth/select-branch` | logged in (cashier) | Set the active branch |
| GET, POST | `/admin/branches` | `admin:branches` | List (`?limit&offset&isActive`) / create branches. Code: 1–3 letters, stored upper-case |
| PATCH | `/admin/branches/:id` | `admin:branches` | Edit a branch, or deactivate / reactivate it with `isActive` |
| GET, POST | `/admin/users` | `admin:users` | List (`?limit&offset&role&isActive`, each user with their branches) / create. Create answers a one-time temporary password |
| PATCH | `/admin/users/:id` | `admin:users` | Edit the full name, or deactivate / reactivate with `isActive` (deactivating ends their sessions). Role and username are fixed in v1 |
| POST | `/admin/users/:id/reset-password` | `admin:users` | New one-time temporary password (not for your own account); ends the user's sessions |
| PUT | `/admin/users/:id/branches` | `admin:users` | Replace a cashier's whole list of branches |
| GET, PUT | `/admin/settings` | `admin:settings` | Client settings: business name, address, phone (GSTIN waits for PD-01). PUT replaces the record |
| POST | `/admin/branches/:id/import` | `admin:import` | CSV import of items and opening stock. The file is the request body (`Content-Type: text/csv`, up to 5 MB). 201 with the counts, or 422 `IMPORT_INVALID` listing every problem, with nothing saved |
| GET | `/admin/reports/:report` | `report:all` | Any report, any branch (`?branchId=`) |
| GET | `/items` | `stock:read` | Search and list, with stock (`?search=&categoryId=&active=&limit&offset`; `active` left out shows both) |
| GET | `/items/lookup` | `bill:create` | Exact match among active items by `?barcode=` or `?code=`, else 404 |
| POST, PATCH | `/items`, `/items/:id` | `item:write` | Create / edit an item; `isActive` deactivates or reactivates it |
| GET, POST, PATCH | `/categories`, `/categories/:id` | `category:write` (read: `stock:read`) | Categories |
| GET | `/vendors` | `vendor:write` | Search by name and list (`?search=&active=&limit&offset`; `active` left out shows both) |
| POST, PATCH | `/vendors`, `/vendors/:id` | `vendor:write` | Create / edit a vendor; `isActive` deactivates or reactivates it. The optional GSTIN must be 15 characters in the GSTIN pattern |
| GET | `/purchases`, `/purchases/:id` | `purchase:write` | List / view purchases |
| POST | `/purchases` | `purchase:write` | Create a draft |
| PUT | `/purchases/:id` | `purchase:write` | Edit a draft |
| POST | `/purchases/:id/post` | `purchase:post` | Post the purchase |
| POST | `/purchases/:id/cancel` | `purchase:cancel` | Cancel a posted purchase |
| POST | `/bills` | `bill:create` | Create a bill (the transaction in 7.3) |
| GET | `/bills`, `/bills/:id` | `bill:read` | Find / view bills |
| POST | `/bills/:id/cancel` | `bill:cancel` | Cancel a bill |
| GET | `/bills/:id/receipt` | `bill:read` | Receipt data for printing |
| GET | `/customers/lookup` | `bill:create` | Find a customer by `?phone=` |
| GET | `/stock` | `stock:read` | Current stock per item, active and inactive (`?categoryId=&limit&offset`). A cashier reads their branch; the Admin names one with `?branchId=` |
| GET | `/stock/:itemId/movements` | `stock:read` | Ledger history for one item, newest first (`?limit&offset`); the Admin adds `?branchId=` |
| POST | `/stock/adjustments` | `stock:adjust` | Create an adjustment |
| GET | `/reports/day-summary` | `report:own-day-summary` | The cashier's own day summary |
| GET | `/reports/stock`, `/reports/low-stock` | `stock:read` | Own-branch stock reports |

### Error codes (proposed, Phase 1–5)

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Request fails its zod schema |
| `INVALID_JSON` | 400 | Request body isn't valid JSON |
| `PAYLOAD_TOO_LARGE` | 413 | JSON body over 1 MB |
| `UNAUTHORIZED` | 401 | No session, or an unknown session |
| `SESSION_EXPIRED` | 401 | The session's 12 hours are over |
| `ACCOUNT_DISABLED` | 401 | The user was deactivated (all their sessions end) |
| `INVALID_CREDENTIALS` | 401 | Login failed — the same answer for a wrong password, an unknown user or a deactivated user |
| `FORBIDDEN` | 403 | Missing permission |
| `NO_ACTIVE_BRANCH` | 403 | A branch-scoped route without a usable active branch |
| `BRANCH_NOT_ASSIGNED` | 403 | Selecting a branch the cashier isn't mapped to |
| `PASSWORD_CHANGE_REQUIRED` | 403 | A temporary password must be changed first; only me / change-password / logout work |
| `WRONG_CURRENT_PASSWORD` | 400 | Change-password with a wrong current password (400, not 401, so the app doesn't treat the user as logged out) |
| `PASSWORD_UNCHANGED` | 400 | The new password equals the current one |
| `DUPLICATE_USERNAME` | 400 | A username that is taken, in any letter case |
| `CANNOT_DEACTIVATE_SELF` | 400 | An Admin tried to deactivate their own account (so an active Admin always remains) |
| `CANNOT_RESET_OWN_PASSWORD` | 400 | An Admin tried to reset their own password; use "Change password" |
| `NOT_A_CASHIER` | 400 | Assigning branches to an Admin; only cashiers have branches |
| `BRANCH_NOT_AVAILABLE` | 400 | Adding a branch that doesn't exist or isn't active; `details.branchIds` lists them |
| `NOT_FOUND` | 404 | Record doesn't exist in the active branch |
| `INSUFFICIENT_STOCK` | 400 | A sale, purchase cancel or adjustment would make stock negative; `details` lists the items |
| `PAYMENT_MISMATCH` | 400 | Payments don't equal the bill total |
| `DOCUMENT_LOCKED` | 400 | Editing or posting a purchase that is no longer a draft, or cancelling an already-cancelled document |
| `EMPTY_PURCHASE` | 400 | Posting a draft purchase that has no lines |
| `DUPLICATE_INVOICE` | 400 | The vendor invoice was already entered |
| `DUPLICATE_CODE` | 400 | A branch code that another branch already uses, or an item code the branch already uses |
| `DUPLICATE_BARCODE` | 400 | A barcode another item of the branch already has |
| `DUPLICATE_NAME` | 400 | A category name the branch already uses (ignoring case) |
| `IMPORT_INVALID` | 422 | The CSV file has problems; `details` lists every `{ row, column, message }` and nothing was saved |
| `IMPORT_CONFLICT` | 400 | The branch's items or categories changed while the file was being saved; nothing was saved, import again |
| `CSV_REQUIRED` | 415 | The import body was not sent as `text/csv` |
| `NOT_SET_UP` | 404 | The client settings don't exist yet: `setup:client` has never run on this database |
| `INTERNAL_ERROR` | 500 | Unexpected; the full stack is logged server-side |

---

## 9. Decisions summary

Full wording and dates: [pending-decisions.md](pending-decisions.md).

### Decided

| ID | Topic | In short |
|---|---|---|
| D-01 | Deployment | Cloud web app, browser at the counter; keep a backup internet connection |
| D-02 | Stock model | Movement ledger; current quantity updated in the same transaction |
| D-03 | Units | No units; whole-number quantity; size in the item name |
| D-04 | Roles | Cashier + minimal Admin; Owner later |
| D-05 | Returns | Not in v1 (FP-02) |
| D-06 | Online booking | Not in v1 (FP-01) |
| D-07 | Tenancy | One client per deployment, several branches |
| D-08 | Branch data | Items, vendors, categories, stock per branch; customers client-wide |
| D-09 | Stack | TypeScript monorepo, Asthiwar style |
| D-10 | Cashier ↔ branch | Admin maps one or more branches; pick at login if several |
| D-11 | Item lookup | Barcode, item code, name search |
| D-12 | Pricing | One current price; purchases may update it |
| D-13 | Zero stock | Billing blocked; enter the purchase first |
| D-14 | Bill corrections | Locked; cancel with reason, then re-bill |
| D-15 | Bill number | `TPR/26-27/000123`, per branch, resets every April |
| D-16 | Payments | Cash / UPI / Card, split allowed, no gateway |
| D-17 | Discounts | Line discount + round-off to nearest rupee |
| D-18 | Customers | Optional phone + name |
| D-19 | Purchases | Draft → post → locked; cancel unless sold |
| D-20 | Adjustments | +/− with a required reason |
| D-21 | Counters | Concurrent counters; day summary per cashier and branch |
| D-22 | Reports | Four reports; cashier limited, Admin all |
| D-23 | Categories | Optional, per branch |
| D-24 | Go-live data | CSV import of items + opening stock |
| D-25 | Language | English now, Tamil-ready |
| D-26 | Vendor dues | Not in v1 (FP-06) |
| D-27 | Node.js | Node 24 LTS |
| D-28 | Dev and test databases | Neon, two free projects in Singapore |
| D-29 | Extra packages | Tailwind Vite plugin, ESLint + Prettier; `@types/*` auto-approved |
| D-30 | Audit log | Every change plus logins, before/after, same transaction |

### Pending

| ID | Topic | Deadline | v1 handling |
|---|---|---|---|
| PD-01 | GST | **Before go-live** | Nullable HSN/rate on items and tax columns on bill lines; calculation off |
| PD-02 | Batch and expiry | When the client needs it | Nullable `batch_no` / `expiry_date` on purchase lines and movements |
| PD-03 | Hosting, production database, backups | Before go-live | Code is hosting-neutral; Supabase (Mumbai) favoured |
| PD-04 | Receipt printer | Before go-live | 80mm layout built first |

---

## 10. Future plans summary

Details: [future-plans.md](future-plans.md).

| ID | Feature | v1 groundwork already in place |
|---|---|---|
| FP-01 | Online booking for customers | Client-wide customer records keyed by phone |
| FP-02 | Sales and purchase returns | Ledger accepts new movement types |
| FP-03 | Owner role and other roles | Permission-based access; a role is a map entry + seed row |
| FP-04 | Copy items/vendors between branches | Branch-scoped tables with the same structure |
| FP-05 | Stock-take screen | Adjustments with reason already in the ledger |
| FP-06 | Vendor dues and payments | Purchases already record vendor, invoice and amount |
| FP-07 | Tamil language | All labels in the i18n dictionary; UTF-8 storage |

---

## 11. Build plan

Each phase starts when the client says go. Every phase ends with `npm run check-types` and `npm test` passing. The small task-by-task version for AI agents, with a progress tracker, is in [build-plan/README.md](build-plan/README.md). Phase 0 there covers the remaining decisions, the databases and git.

| Phase | Deliverables | Done when |
|---|---|---|
| **1. Foundation** | Monorepo (shared, database, backend, frontend), TypeScript config, env validation, response and error libraries, pino logger, `/health`, Drizzle + migration runner, Vitest with a test database | `/api/v1/health` returns the success envelope; tests run against the test DB |
| **2. Access** | Users, branches, user_branches, sessions, client_settings; auth routes; permission middleware; branch-scope helper; `setup:client`; Login, Branch picker and Admin screens (branches, users and mapping, settings) | The Admin creates a branch and a cashier and maps them; the cashier lands in the right branch; 401 and 403 cases are tested |
| **3. Catalog and ledger** | Categories, items, vendors, item_stock, stock_movements, `stock.service.postMovement`, CSV import; their screens | A 1,000-row CSV imports correctly; ledger sums equal `item_stock`; concurrent movements on one item stay correct |
| **4. Purchases** | Draft, edit, post, cancel; purchase screens | Posting adds stock; cancel is blocked after a sale; duplicate invoices are blocked |
| **5. Billing** | Billing counter screen, bill create/cancel, customer lookup, receipt print (80mm), bills list | The manual flow in [12](#12-testing-strategy) passes; concurrency and financial-year tests pass |
| **6. Adjustments and reports** | Stock adjustments; all four reports (cashier and Admin views); i18n dictionary for every label | Report figures match the bills and ledger in tests; no hard-coded UI labels |
| **7. Hardening** | Login rate limit, audit review, backup and restore script, deploy runbook | Backup restored successfully on a test server; PD-01, PD-03 and PD-04 decided |

Packages approved with the plan: see [implementation_plan.md](implementation_plan.md#packages-approved-with-this-plan). Any other package needs approval first.

---

## 12. Testing strategy

| Level | What | Tool |
|---|---|---|
| Unit | Service logic: line totals, discounts, round-off, financial-year label, bill number format, permission map | Vitest |
| Integration | Every API route: success, validation (422), auth (401), permission (403), branch isolation | Vitest + Supertest against a test PostgreSQL database |
| Concurrency | Two counters billing the last unit (exactly one succeeds; stock ends at 0); 50 parallel bills give gapless numbers; parallel movements on one item | Vitest + parallel requests |
| Date edges | A bill at 31 Mar 23:59 IST vs one at 1 Apr 00:01 IST land in different financial years; an 11:30 PM IST bill gets the right business date | Vitest |
| Manual (Phase 5) | Log in as a cashier → scan and type items → split-payment bill → print → cancel → check that stock and the day summary agree | Browser + scanner + printer |

Frontend component tests would need extra packages (e.g. Testing Library), which aren't approved yet. Instead, the logic behind the screens (routing rules, session rules, cache clearing, error text, form checks) is unit-tested, and each screen is verified by hand in the browser as part of its task, plus the manual checklist above.

---

## 13. Operations and go-live

### 13.1 Hosting and database (PD-03, pending)
- **Leaning:** frontend on Vercel, backend on Render (Singapore), database on Neon (Singapore), with Vercel rewriting `/api/*` to Render so the browser sees one origin. A staging copy is deployed in build Task 1.10. Plan implications are in PD-03.
- **Database:** a managed PostgreSQL is favoured. Supabase has a Mumbai region; Neon's nearest is Singapore. Full comparison in PD-03.
- **Same region:** the app server (Nginx + PM2) must run in the same region as the database, because every bill makes several database round trips.
- The code doesn't depend on the choice. It uses plain PostgreSQL through Drizzle.
- Development and test databases: D-28, decided in build Task 0.1.

### 13.2 Backups
- Daily automated database backups, copied **off the server**. Frequency and retention are settled in PD-03.
- Phase 7 includes a tested **restore**: a backup that has never been restored doesn't count.

### 13.3 Go-live checklist
- [ ] PD-01 GST decided and implemented (for a GST-registered store)
- [ ] PD-03 hosting set up, HTTPS working, backups running, restore tested
- [ ] PD-04 printer tested at every counter
- [ ] Items and opening stock imported and checked against the shelves
- [ ] Cashier accounts created and mapped; passwords changed
- [ ] Backup internet connection at each counter (D-01)
- [ ] Staff shown the billing, purchase entry and day-end steps

### 13.4 Logs
- pino writes structured logs: requests, errors with stack traces, slow queries.
- PM2 keeps the process running and rotates logs.
- Business actions are recorded in `audit_logs`, not in the app logs.

---

## 14. Risks and open items

| Risk | Impact | Mitigation |
|---|---|---|
| Internet outage at a branch | Billing stops (cloud app) | Backup 4G connection (D-01). An offline mode isn't in scope. |
| GST not decided by go-live | Bills not GST-compliant | Columns are ready; decide PD-01 before Phase 7 |
| Zero-stock blocking (D-13) | A sale waits until the purchase is entered | Fast purchase entry with drafts; staff enter purchases when goods arrive |
| Cashiers can cancel bills and adjust stock until the Owner role exists | Possible misuse | Every action is in the audit log with a reason; cancellations appear in the day summary; FP-03 restricts them |
| Bad import data | Wrong prices or stock at go-live | Import checks every row before saving; stock report checked against the shelves |
| Session left open on a shared counter PC | Someone else bills under that cashier's name | Session expiry; logout at shift end |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **Ledger** | The `stock_movements` table: an append-only list of every stock change |
| **Movement** | One row in the ledger: an item, a signed quantity, and why |
| **Opening stock** | The shelf quantity entered at go-live (movement type `opening`) |
| **Draft** | A purchase that is saved but hasn't changed stock yet |
| **Post** | Confirm a purchase: stock is added and the purchase is locked |
| **Cancel** | Reverse a bill or posted purchase with a reason; the document stays on record |
| **Immutable** | Can't be edited after saving; corrections are made by cancel + new document |
| **Branch-scoped** | Data that belongs to one branch and is only visible in that branch |
| **Active branch** | The branch a cashier is currently working in |
| **Paise** | 1/100 of a rupee; all money is stored in paise |
| **Round-off** | Adjustment that rounds the bill total to the nearest rupee |
| **FY** | Financial year, 1 April – 31 March (e.g. `26-27`) |
| **MRP** | Maximum Retail Price printed on the pack |
| **HSN** | Harmonised System of Nomenclature code, used for GST |
| **GSTIN** | GST registration number |
| **Reorder level** | Quantity at or below which an item appears on the low-stock report |
| **Permission** | A named action (e.g. `bill:create`) granted to a role |
| **Deployment** | One client's running copy of the app with its own database |

---

## 16. Keeping this document current

- When a decision, plan or architecture detail changes, update its **authoritative file** first (section 2), then the matching section here, in the same change.
- When a **(proposed)** item is confirmed or changed during its phase, update this document and drop the marker.
- Update the "Last updated" date at the top.
