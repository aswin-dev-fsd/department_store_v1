# Decisions

Decisions that shape the database and core design. **Pending** items need an answer before the part they block is built. **Decided** items record what was agreed. Technical conventions (money in paise, time zones, layout) live in the root `AGENTS.md`.

Last updated: 2026-10-10

## Pending

### PD-01 — GST
Status: Pending. **Must be decided before go-live** for a GST-registered store.

v1 handling: items carry nullable `hsn_code` and `gst_rate`, and bill lines carry nullable tax-amount columns. GST calculation stays off until this is decided, so turning it on is a logic change, not a schema change.

To settle:
- HSN code and GST rate per item
- Prices MRP-inclusive (tax inside the price) or tax added on top
- CGST/SGST split on the bill, and IGST if there are inter-state sales
- One GSTIN for all branches, or one per branch (branches in different states) — confirm the D-15 bill number format fits
- Line discounts (D-17) reduce the taxable value — confirm with the client's accountant

### PD-02 — Batch and expiry tracking
Status: Pending. The database is ready for it now.

v1 handling: purchase lines and stock movements carry nullable `batch_no` and `expiry_date` columns. They are optional, and v1 billing ignores them.

To settle:
- Which items need batch/expiry: all items, or only some categories (FMCG, medicines)
- Whether billing picks a batch (oldest expiry first) or ignores batches
- Expiry alerts: how many days before expiry
- Whether each lot keeps its own price (see D-12)

### PD-03 — Hosting, production database and backups
Status: Pending. Decide before go-live; the code doesn't depend on it. The user is leaning towards a managed database, Supabase or Neon (2026-10-10).

**Rule:** put the app server and the database in the **same region**. Every bill runs several queries inside one transaction, so every extra network round trip slows billing and holds stock locks longer.

| Option | Nearest region to the stores | Notes |
|---|---|---|
| **Supabase**, paid plan — recommended | Mumbai (`ap-south-1`) | Managed PostgreSQL with dashboard and daily backups. Paid projects never pause. We use only its database: turn off the Data API, and connect with the Session pooler string. |
| **Neon** | Singapore (no India region as of Oct 2026) | Excellent branching for dev and test databases. Scale-to-zero adds a short delay after idle periods unless it's turned off. A project's region can't be changed later. |
| App server + managed PostgreSQL from one provider (e.g. AWS Mumbai, DigitalOcean Bangalore) | India | Same datacenter, private network, one bill |
| PostgreSQL self-hosted on the app VPS | India | Cheapest; you own updates, monitoring and backups |

Whichever is chosen, Task 7.4 still keeps our own daily `pg_dump` backups outside the provider.

**Update (2026-10-10):** Vercel + Render is decided for **dev/staging only** (D-31). **Production is leaning towards AWS**, a different strategy to be planned before go-live. AWS has a **Mumbai** region (`ap-south-1`), so production app and database can both sit in India, which re-opens the Singapore-only constraint below. The notes that follow describe the staging setup.

**Staging (Task 1.10): frontend on Vercel, backend on Render.** What this choice implies:
- **One origin:** Vercel rewrites `/api/*` to Render, so session cookies stay first-party. A direct browser → Render call would be a blocked third-party cookie.
- **Region:** Render's nearest region is **Singapore** (no India). The database must then also be in Singapore: Neon (current) or Supabase's Singapore region, *not* Supabase Mumbai. Each browser request crosses the India–Singapore link once; the database queries stay inside Singapore.
- **Production plans:** Render **Starter or above** (the free plan sleeps after 15 idle minutes); Vercel **Pro** (Hobby forbids commercial use, including paid client work); Neon paid with scale-to-zero off.
- **No PM2 or Nginx:** Render runs the process and terminates TLS. This replaces DreamLand §3's PM2 for this project. Tasks 7.4 (backups need a scheduler, e.g. a Render Cron Job or a GitHub Actions schedule) and 7.5 (deploy kit) must be rewritten for this platform once it's decided.
- **Proxy timeout:** Vercel's rewrite limit is 30 seconds per request. All API calls are short; check the CSV import (Task 3.7) against it.
- **Client IP depends on the proxy chain:** `TRUST_PROXY` must equal the number of proxies between the visitor and the app, and be re-verified for every environment (staging's chain Vercel → Cloudflare → Render needs more than 2; AWS will differ). In production the origin must be reachable only through its front proxy, otherwise visitors can spoof their IP. Procedure: `dev-setup.md` §11; history: `architecture.md` §14.
- **Simpler alternative to weigh:** Express serves the built frontend from the same Render service. That gives one service, one domain and no proxy hop, avoids Vercel's cost and 30-second limit, but loses Vercel's CDN, which matters little for an in-store app.

Fixed requirement: production must run **PostgreSQL 18**. Dev and test run 18.6 on Neon (checked 2026-10-10, Task 1.4).

To settle: database provider and region, app server provider (same region), backup frequency and retention, domain and SSL.

### PD-04 — Receipt printer
Status: Pending. v1 builds an 80mm thermal receipt layout first.

To settle:
- Printer width per branch: 80mm, 58mm, or A4/A5
- Silent printing (Chrome kiosk-printing mode) or the normal print dialog
- Whether a cash drawer needs to open on print

## Decided

| ID | Topic | Decision | Date |
|---|---|---|---|
| D-01 | Deployment | Cloud web app: hosted server, browser at the billing counter. Billing needs internet, so keep a backup connection (e.g. 4G dongle) at the counter. | 2026-10-10 |
| D-02 | Stock model | Stock movement ledger: every stock change is a row (opening, purchase, sale, cancels, adjustment). The item's current quantity is updated in the same database transaction as the ledger row. | 2026-10-10 |
| D-03 | Units | No units. Quantity is a whole count of packs, and the item name carries the size ("Rice 10 kg"). Each pack size is a separate item. | 2026-10-10 |
| D-04 | Users and roles | Two roles in v1. **Cashier**: billing, purchases, items, vendors, stock adjustments. **Admin** (minimal): branches, users, cashier–branch mapping, password resets, client settings, CSV import, all reports. Owner and other roles can be added later without a schema change — see FP-03. | 2026-10-10 |
| D-05 | Returns | Not in v1. Comes later, after requirements are confirmed — see [future-plans.md](future-plans.md) FP-02. | 2026-10-10 |
| D-06 | Online booking | Not in v1 — see [future-plans.md](future-plans.md) FP-01. | 2026-10-10 |
| D-07 | Tenancy | One client per deployment, with several branches. A new client gets its own copy of the app and its own database. | 2026-10-10 |
| D-08 | Branch data | Items, categories, vendors and stock belong to one branch; branches don't share them. Customers are client-wide (the same phone number is the same person at any branch). Copying data between branches is FP-04. | 2026-10-10 |
| D-09 | Stack | Full-stack TypeScript monorepo, as in Asthiwar_v1: Express, Drizzle ORM, PostgreSQL, zod, Vitest + Supertest, React + Vite + Tailwind. Details in `AGENTS.md`. | 2026-10-10 |
| D-10 | Cashier ↔ branch | Admin maps each cashier to one or more branches. With one branch the cashier goes straight in after login; with several, they pick a branch at login. | 2026-10-10 |
| D-11 | Item lookup | Barcode scan (optional, unique per branch), item code (unique per branch), and name search. | 2026-10-10 |
| D-12 | Pricing | Each item has one current MRP and selling price. A purchase line records the cost price and may update the item's price; all stock then sells at the current price. | 2026-10-10 |
| D-13 | Zero stock | Billing is blocked when stock is insufficient. The fix is to enter the purchase first. Stock never goes negative. | 2026-10-10 |
| D-14 | Bill corrections | Saved bills are locked. The cashier can cancel a bill with a reason; stock is added back through the ledger, the bill number stays in the sequence marked Cancelled, and the sale is billed again. | 2026-10-10 |
| D-15 | Bill number | `TPR/26-27/000123`: branch code (up to 3 letters), financial year, running number. One sequence per branch, restarting every 1 April (IST), gapless, at most 16 characters. | 2026-10-10 |
| D-16 | Payments | Cash, UPI and Card, recorded by the cashier; one bill can be split across modes. No payment gateway. | 2026-10-10 |
| D-17 | Discounts | Discount per bill line, and the bill total rounded to the nearest rupee. No whole-bill discount in v1. | 2026-10-10 |
| D-18 | Customers | Optional customer phone and name on a bill; entering a phone creates or reuses a customer record. | 2026-10-10 |
| D-19 | Purchases | Draft → post → locked. Drafts don't change stock; posting adds stock. A posted purchase can be cancelled with a reason, unless its stock has already been sold. | 2026-10-10 |
| D-20 | Stock adjustments | +/− quantity with a required reason: damage, expiry, theft, count correction, or other with a note. Recorded in the ledger with who and when. | 2026-10-10 |
| D-21 | Counters | Several counters can bill at the same time in a branch. The day-end summary is per cashier and per branch. | 2026-10-10 |
| D-22 | Reports | Day sales summary, item-wise sales, stock with movement history and low stock (reorder level per item), and purchase register. Cashiers see their own day summary plus their branch's stock and low stock; Admin sees all reports across branches. | 2026-10-10 |
| D-23 | Categories | Optional; one category per item; each branch keeps its own category list. | 2026-10-10 |
| D-24 | Go-live data | Admin imports items and opening stock per branch from CSV (Excel → Save As CSV). Opening stock is recorded in the ledger as `opening`. | 2026-10-10 |
| D-25 | Language | English UI now. All labels sit in a dictionary file so Tamil can be added later (FP-07). | 2026-10-10 |
| D-26 | Vendor dues | Not in v1. Purchases record what came in and the invoice amount only — see FP-06. | 2026-10-10 |
| D-27 | Node.js version | Node.js 24 LTS (was PD-05). DreamLand §3 updated from Node 20, which reached end-of-life in April 2026. | 2026-10-10 |
| D-28 | Dev and test databases | Neon: two free projects in Singapore (`aws-ap-southeast-1`), `dept-store-dev` and `dept-store-test`, using **direct** (not pooled) connection strings. Changed from Supabase on the same day because Supabase's free plan allows only 2 active projects; Neon's allows many. The production database stays under PD-03. | 2026-10-10 |
| D-30 | Audit log scope | **Every change plus logins.** Every create, edit, delete and status change, plus login success and failure, logout and password changes, writes an `audit_logs` row: who, when, branch, action, entity, before/after (secrets redacted). Written in the same transaction as the change. Viewing data is not logged. | 2026-10-10 |
| D-31 | Staging platform | **Dev/staging only:** frontend on Vercel, backend on Render (Singapore), database on a separate Neon project `dept-store-staging`, with Vercel rewriting `/api/*` to Render. Production uses a different strategy (AWS leaning; see PD-03). Render's health check and any keep-awake ping use `/api/v1/health/live`, which doesn't touch the database, so Neon can sleep and stays within its free compute hours. | 2026-10-10 |
| D-29 | Extra packages | Approved: `@tailwindcss/vite`; `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`. `@types/*` packages for an approved package count as approved. | 2026-10-10 |
