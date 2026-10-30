# Phase 4 — Purchases

**Goal:** stock arrives through purchase entry: draft → post → (cancel). This is the only normal way stock goes up after go-live (D-13, D-19).

**Read first for the whole phase:** overview §6.7, §7.5; D-12, D-19, D-26; Task 3.2 (`postMovements`).

---

## Task 4.1 — Purchase tables

**Goal:** `purchases` and `purchase_lines` exist.

**Read first:** `docs/implementation_plan.md` → Data model; overview §5.2 "Documents".

**Files:** `database/src/schema/purchases.ts`, `schema/index.ts`, a generated migration

**Steps:**
1. Enum `purchase_status`: `draft`, `posted`, `cancelled`.
2. `purchase_lines.quantity` has `CHECK (quantity > 0)`; `cost_price_paise >= 0`.
3. Partial unique index on `purchases (branch_id, vendor_id, lower(vendor_invoice_no)) WHERE status <> 'cancelled'`. Write it by hand in the migration if Drizzle can't express it, and note that in the migration file.
4. Nullable `batch_no` and `expiry_date` on `purchase_lines` (PD-02).
5. Generate, **read the SQL**, apply.

**Done when:**
- [ ] The migration applies to an empty database
- [ ] A test proves the partial unique index: a duplicate is blocked, but allowed after the first is cancelled

**Commit:** `feat(database): add purchase tables`

**As built (2026-10-30):**
- **Files:** `database/src/schema/purchases.ts` (the `purchase_status` enum, `purchases`, `purchase_lines`), `schema/index.ts`, migration `0002_purchases.sql` (+ snapshot and journal), and `backend/test/schema/purchases.schema.test.ts` (17 tests, raw SQL; the file the "Done when" test needs).
- **The SQL, read line by line:** it only adds things (one enum, two tables, 7 foreign keys, 2 CHECKs, 1 index) and changes nothing that exists. Drizzle could express the partial unique index (`lower(vendor_invoice_no)` and `WHERE status <> 'cancelled'`), so nothing in the migration is hand-written.
- **Choices the task left open:** columns as in overview §5.2 "Documents"; every foreign key `ON DELETE RESTRICT`, like Phase 3; `total_paise` and `line_total_paise` required with no default, because the server always computes them (Task 4.2); `purchase_lines` has no `updated_at`, because editing a draft replaces all its lines (Task 4.2); drafts count for the unique index, so a second draft of the same invoice is refused too.
- **Applied to:** the dev database (on top of 0000 and 0001 and the seeded data). Staging gets it at Render's next build; it only adds tables.
- **Not run:** under option 3 the 17 tests are written but not run, and "applies to an empty database" is checked at Checkpoint 4, so both "Done when" boxes stay open.
- **Not in the task, so not built (proposed for you):** an index on `purchase_lines (purchase_id)` (PostgreSQL doesn't index foreign keys, and lines are always read by purchase); non-negative CHECKs on the totals and the new prices; CHECKs tying the status to its fields (posted ⇒ `posted_by`/`posted_at` set; cancelled ⇒ the cancel fields set); a composite foreign key that keeps the vendor in the purchase's branch (Task 4.2 refuses it in the service).

---

## Task 4.2 — Purchase drafts API

**Goal:** cashiers create, edit, list and view draft purchases. Drafts never touch stock.

**Files:** `shared/src/schemas/purchases.ts`, `backend/src/modules/purchases/purchases.{routes,controller,service}.ts`, `purchases.drafts.test.ts`

**Steps:**
1. **Red** — tests:
   - **Create:** `POST /purchases` with vendor, invoice number, invoice date, and lines (zero or more) → `draft`. The server computes `total_paise` as Σ quantity × cost price.
   - **Edit:** `PUT /purchases/:id` replaces the header and all lines while still a draft. On a posted or cancelled purchase → 400 `DOCUMENT_LOCKED`.
   - **Duplicate invoice:** the same vendor and invoice number (case-insensitive) in the branch → 400 `DUPLICATE_INVOICE`.
   - **Validation:** the vendor and items must be active and in the active branch.
   - **List:** filter by status, vendor and date range; paginated. **Get:** includes lines with item names.
   - **No stock effect:** stock and the ledger are unchanged by any draft operation.
2. **Green** — implement.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(purchases): add draft purchases api`

**As built (2026-10-30):**
- **Files:** the named shared schema, routes, controller, service and test (`backend/src/modules/purchases/purchases.drafts.test.ts`), plus, as for every Phase 3 module, `purchases.model.ts` (the queries), a shared schema test (`shared/src/schemas/purchases.test.ts`), the export in `shared/src/index.ts` and the `/purchases` registration in `backend/src/routes.ts`. No `lib` change, no migration, no new package.
- **Routes:** `GET /purchases` (`?status=&vendorId=&from=&to=&limit=&offset=`, newest invoice date first; the date range compares the invoice date, both ends included), `GET /purchases/:id` (with lines in entry order, each with the item's code and name, and who created, posted and cancelled it), `POST /purchases` (201), `PUT /purchases/:id`. All need `purchase:write` and a chosen branch.
- **One body for create and edit:** vendor, invoice number (trimmed, 1–50 characters), invoice date (a real YYYY-MM-DD date), optional notes, and zero or more lines (item, quantity, cost price, optional new MRP and selling price). Totals, status and the post and cancel fields are the server's, and batch and expiry are not accepted until PD-02: zod drops them all.
- **Choices the task left open:** an edit replaces the whole draft, so notes left out are cleared; it writes and audits only what really changed (the changed header fields, plus `lines` before and after when the lines differ), and an edit that changes nothing writes nothing. The same item may appear on two lines (an invoice may list it twice). A duplicate invoice is caught from the Task 4.1 unique index, so two counters saving the same invoice at once also get `DUPLICATE_INVOICE`, not a 500. The vendor and items are checked on every save, so an item deactivated after the draft was started must be removed before the draft is saved again.
- **Caps** (sanity limits, like the item price cap): 1,000,000 packs a line (the import's cap), 500 lines, and a total that must stay below 2^53 paise so it is added up exactly.
- **Not run:** under option 3 the 45 route tests and 37 schema tests are written but not run; the "Done when" box is ticked at Checkpoint 4.
- **Not in the task, so not built (proposed for you):** refusing a draft line whose new selling price is above its new MRP. Task 4.3 checks the rule at posting, against the item's stored prices too.

---

## Task 4.3 — Post a purchase

**Goal:** posting adds stock, applies new prices, and locks the purchase, all in one transaction.

**Files:** `purchases.service.ts`, `purchases.routes.ts`, `purchases.post.test.ts`

**Steps:**
1. **Red** — tests:
   - **Post:** `POST /purchases/:id/post` → status `posted`, `posted_by`/`posted_at` set; one `purchase` movement per line (`refType: purchase`); stock increased.
   - **New prices:** a line with `new_selling_price_paise` / `new_mrp_paise` updates the item, with an audit row per change. The selling-price ≤ MRP rule applies.
   - **Empty draft:** posting with no lines → 400 `EMPTY_PURCHASE`.
   - **Wrong state:** posting again, or posting a cancelled purchase → 400 `DOCUMENT_LOCKED`.
   - **Concurrency:** two parallel post requests → exactly one succeeds; stock is added once.
   - `assertLedgerMatchesStock` passes for every item.
2. **Green** — one transaction:
   1. Lock the purchase row (`FOR UPDATE`) and check it is a `draft`.
   2. `postMovements` with + quantities.
   3. Apply price updates and write audit rows.
   4. Set the status.

**Done when:**
- [ ] All tests pass
- [ ] The concurrency test passes 10 runs in a row

**Commit:** `feat(purchases): post purchases into stock`

---

## Task 4.4 — Cancel a purchase

**Goal:** a posted purchase can be cancelled with a reason, unless its stock has already been sold.

**Files:** `purchases.service.ts`, `purchases.routes.ts`, `purchases.cancel.test.ts`

**Steps:**
1. **Red** — tests:
   - **Cancel:** `POST /purchases/:id/cancel { reason }` → status `cancelled`, cancel fields set; one `purchase_cancel` movement per line; stock back to its previous level.
   - **Reason:** required, at least 3 characters → 422 otherwise.
   - **Stock already sold:** simulate a sale by calling `postMovements` with type `sale` in the test. Cancel → 400 `INSUFFICIENT_STOCK` listing the items, and **nothing changes**.
   - **Drafts:** cancelling a draft → 400 `DOCUMENT_LOCKED`. Drafts are just edited.
   - **Prices:** item prices are **not** reverted. Document this in the code.
   - **Re-entry:** after a cancel, the same vendor invoice can be entered again as a new draft.
   - An audit row is written.
2. **Green** — one transaction: lock, check `posted`, `postMovements` with − quantities (this throws when stock is insufficient), set the status.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(purchases): cancel posted purchases`

---

## Task 4.5 — Frontend: purchases

**Goal:** fast purchase entry in the browser, built for a cashier who gets interrupted by customers.

**Read first:** overview §7.5, §6.7.

**Files:** `frontend/src/pages/purchases/*`, shared item-picker component `frontend/src/components/ItemPicker.tsx` (reused by billing), `en.ts`

**Steps:**
1. **List:** filter by status, vendor and date; status badges; open a draft to continue it.
2. **Editor:**
   - Header: vendor select with search, invoice number, date.
   - Line entry with `ItemPicker`: barcode or code + Enter, or name search with arrow keys.
   - Per line: quantity, cost (in rupees), optional new MRP and selling price.
   - Running total.
   - **Save draft** at any time.
3. **Post:** a confirmation dialog showing the line count and total. **Cancel:** a dialog with a required reason.
4. Keyboard **(proposed)**: Enter moves to the next field; a new line starts after the last field.
5. Show `DUPLICATE_INVOICE`, `INSUFFICIENT_STOCK` and `DOCUMENT_LOCKED` as clear messages.

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check on seeded data: the Checkpoint 4 review below

**Commit:** `feat(frontend): add purchase entry screens`

---

## 🛑 Checkpoint 4

Agent: follow the checkpoint steps in `README.md`.

**Checkpoint review (user):**
- [ ] Enter a 20-line purchase, save it as a draft halfway, leave the page, come back, finish it, and post it
- [ ] Check stock went up and the item's history shows the purchase
- [ ] Post a purchase with a new selling price, and check the item's price changed
- [ ] Cancel a posted purchase, then try cancelling one whose stock was partly used (simulated via the seed or a test): it's blocked with a clear message
- [ ] Try entering the same vendor invoice twice
