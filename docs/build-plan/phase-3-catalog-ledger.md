# Phase 3 — Catalog and Ledger

**Goal:** items, categories and vendors per branch, plus the **stock ledger** — the one place where stock changes — and the CSV import used at go-live.

**Read first for the whole phase:** overview §5 (data model, especially §5.3 the ledger), §6.1 (items and prices), §7.1 (go-live); `AGENTS.md` → Stock ledger, Branch-scoped data, Money; D-02, D-03, D-08, D-11, D-12, D-23, D-24.

Task 3.2 is the most important service in the system. Take it slowly; its tests are the safety net for everything that moves stock later.

---

## Task 3.1 — Catalog and ledger tables

**Goal:** the catalog and ledger tables exist.

**Read first:** `docs/implementation_plan.md` → Data model; overview §5.2 "Catalog" and "Ledger and audit".

**Files:** `database/src/schema/catalog.ts`, `database/src/schema/ledger.ts`, `schema/index.ts`, a generated migration

**Steps:**
1. Tables: `categories`, `items`, `item_stock`, `vendors`, `stock_movements`.
2. Constraints:
   - `item_stock.quantity` has `CHECK (quantity >= 0)`.
   - `stock_movements.quantity` has `CHECK (quantity <> 0)`.
3. Enums:
   - `movement_type`: `opening`, `purchase`, `purchase_cancel`, `sale`, `sale_cancel`, `adjustment`
   - `movement_ref_type`: `bill`, `purchase`, `adjustment`, `import`
   - `adjustment_reason`: `damage`, `expiry`, `theft`, `count_correction`, `other`
4. Indexes:
   - unique `items (branch_id, code)`
   - unique `items (branch_id, barcode) WHERE barcode IS NOT NULL`
   - `items (branch_id, lower(name))`
   - `stock_movements (item_id, created_at)`
   - unique `categories (branch_id, lower(name))`
5. Nullable pending-feature columns: `items.hsn_code`, `items.gst_rate`, `stock_movements.batch_no`, `stock_movements.expiry_date`.
6. Generate the migration, **read the SQL**, and apply it.

**Done when:**
- [x] The migration applies to an empty database
- [x] check-types passes
- [x] The constraints exist (a test that inserts a negative `item_stock` gets a constraint error)

**Commit:** `feat(database): add catalog and ledger tables`

**As built (2026-10-14):**
- **Files:** `database/src/schema/catalog.ts` (`categories`, `items`, `item_stock`, `vendors`), `ledger.ts` (the three enums and `stock_movements`), `index.ts`, migration `0001_catalog_and_ledger.sql` (+ snapshot and journal), and `backend/test/schema/catalog.schema.test.ts` (43 tests, raw SQL).
- **Choices the task left open:** quantities and `balance_after` are `integer`; prices are `bigint` paise; `gst_rate` is `numeric(5,2)` (PD-01 hasn't decided how GST is stored); every foreign key is `ON DELETE RESTRICT` (nothing is deleted); `ref_type` is required and `ref_id` optional (an import has no id); `item_stock` has no `updated_at` (the ledger is its history).
- **Applied to:** an empty test database (schema dropped, `db:migrate` applied 2 migrations, a second run changed nothing) and the dev database. Staging gets it at Render's next build; it only adds tables.
- **Proven by removing it once:** the `item_stock` CHECK (2 tests red), the `stock_movements` CHECK (1), the barcode, item-code and category-name unique indexes (1 each).
- **Not in the task, so not built (proposed for the user):** composite foreign keys that make a cross-branch item, category or ledger row impossible in SQL (Task 3.2 refuses it in the service); `CHECK (balance_after >= 0)`; non-negative price checks.

---

## Task 3.2 — Stock ledger service

**Goal:** `postMovements` — the only function in the system that changes stock — is correct under concurrency.

**Read first:** overview §5.3; `AGENTS.md` → Stock ledger.

**Files:** `backend/src/modules/stock/stock.service.ts`, `backend/src/modules/stock/stock.service.test.ts`, `backend/test/helpers/ledger.ts`

**Signature:**
```ts
postMovements(tx, {
  branchId, userId,
  movements: Array<{
    itemId; quantity /* signed, ≠ 0 */; type; refType; refId?;
    reason?; note?; batchNo?; expiryDate?;
  }>,
}): Promise<Array<{ itemId; balanceAfter }>>
```

**Steps:**
1. **Red** — tests:
   1. A `+5` movement on an item with stock 0 → stock 5; one ledger row with `balance_after` 5.
   2. A `−2` movement → stock 3, `balance_after` 3.
   3. A `−10` on stock 3 → throws `AppError` `INSUFFICIENT_STOCK` with `details: [{ itemId, name, available: 3, requested: 10 }]`. **No rows written**, stock still 3.
   4. Several movements in one call, one of them insufficient → nothing is written for any item.
   5. The same item twice in one call (e.g. two bill lines) is checked against the combined quantity.
   6. An item from another branch → `NotFoundError`, nothing written.
   7. **Concurrency:** stock 1; two parallel transactions each post `−1` → exactly one succeeds, final stock 0.
   8. **Concurrency:** 20 parallel transactions each post `+1` → final stock 20, and the 20 `balance_after` values are exactly 1–20.
   9. **Invariant helper** `assertLedgerMatchesStock(itemId)`: the sum of movements equals `item_stock.quantity`. Run it at the end of every test above.
2. **Green** — implement:
   1. Merge movements per item.
   2. Lock the `item_stock` rows with `SELECT … FOR UPDATE`, ordered by `item_id` ascending, joined to `items` to check the branch.
   3. Compute the new balances. If any would be below 0, throw — before any write.
   4. Update `item_stock`.
   5. Insert the movement rows with `balance_after`.
3. Note: this function never opens a transaction. Callers pass `tx`, so the stock change commits or rolls back together with the bill, purchase or adjustment that caused it.

**Done when:**
- [x] All nine tests pass
- [x] Run the two concurrency tests 10 times in a row (`vitest --repeat` or a loop) — no flakes

**Commit:** `feat(stock): add ledger service with row locking`

**As built (2026-10-14):**
- **Files:** the three named, plus `stock.model.ts` (the queries, per the layout rule) and `createItem` in `test/helpers/fixtures.ts`. 19 tests: the nine above and 4 more (guards, empty list, inactive item, the helper itself), several split into more cases.
- **Behaviour the spec left open:** the result has one entry per input movement, in order. Movements apply in input order, and an item that would dip below zero *at any point* is refused, reporting the lowest point (`available` = stock before the call, `requested` = what was needed; for a sale that is the combined quantity). A zero or non-integer quantity is `INVALID_MOVEMENT`; an empty list does nothing; an inactive item can still move; `tx` is typed `Tx`, so a bare database handle cannot be passed.
- **The invariant helper** also checks every row's `balance_after` against the running total.
- **Proven by breaking it once:** no `FOR UPDATE` (both concurrency tests red); writing before the check (the 6 failure-path tests red, success paths green); no running balance (the same-item test red); no branch condition (the other-branch test red). The two concurrency tests ran 10 times in a row, 10 clean; the first one holds its lock with `pg_sleep` so the second call certainly overlaps.
- **Not separately provable:** the lock *order* (`ORDER BY item_id` in one statement). Two callers run the same plan, so they queue in the same order with or without it; the explicit `ORDER BY` is what makes that a guarantee rather than luck.

---

## Task 3.3 — Categories API

**Goal:** cashiers manage their branch's categories.

**Files:** `shared/src/schemas/categories.ts`, `backend/src/modules/categories/categories.{routes,controller,service,test}.ts`

**Steps:**
1. **Red** — tests:
   - List, create and rename within the active branch.
   - A duplicate name in the same branch (case-insensitive) → 400 `DUPLICATE_NAME`. The same name in another branch is allowed.
   - **Branch isolation:** a cashier in branch A gets 404 for branch B's category ID.
   - Admin → 403 on write.
2. **Green** — implement through the branch-scoped helper.

**Done when:**
- [x] All tests pass

**Commit:** `feat(catalog): add categories api`

**As built (2026-10-14):**
- **Files:** the named schema, routes, controller, service and tests (`categories.routes.test.ts`, like the branches module), plus `categories.model.ts` (the queries), a shared schema test, a `createCategory` fixture, and the export and route registration. 27 route tests and 5 schema tests.
- **Open choices:** reads need `stock:read` (as overview §8 says) and writes `category:write`, so an Admin gets 403 on writes and, having no branch, 403 `NO_ACTIVE_BRANCH` on the list. The list is ordered by name ignoring case, with the standard paging. A rename takes `{ name }`; names are 1–100 characters. Renaming to the same name writes nothing; changing only the capital letters is allowed.
- **Proven by breaking it once:** the permission check, branch isolation on rename, branch isolation on the list, the duplicate-safe insert (the duplicate test and the two-cashiers-at-once test went red) and the audit call.
- `DUPLICATE_NAME` added to the overview's error-code table; the screen's error text comes with Task 3.9.

---

## Task 3.4 — Items API

**Goal:** cashiers create, edit, search, look up and deactivate items.

**Read first:** overview §6.1, §8 (items endpoints); D-11, D-12.

**Files:** `shared/src/schemas/items.ts`, `backend/src/modules/items/items.{routes,controller,service,test}.ts`

**Steps:**
1. **Red** — tests:
   - **Create:** inserts the item **and** its `item_stock` row (quantity 0) in one transaction.
   - **Code and barcode:** `code` is unique per branch; `barcode`, when given, is unique per branch → 400 `DUPLICATE_CODE` / `DUPLICATE_BARCODE`.
   - **Price rule (proposed):** a selling price above MRP → 422.
   - **Edit a price:** an audit row with before/after prices.
   - **Search:** `GET /items?search=rice` matches name, code or barcode (case-insensitive). Supports `categoryId`, `limit`/`offset`, and includes current stock.
   - **Lookup:** `GET /items/lookup?barcode=…` or `?code=…` → exact match among **active** items; otherwise 404.
   - **Deactivate:** a deactivated item disappears from lookup but stays in search with an `active=false` filter.
   - **Branch isolation**, and Admin 403 on write.
   - Money is integer paise in both requests and responses.
2. **Green** — implement.

**Done when:**
- [x] All tests pass

**Commit:** `feat(catalog): add items api`

**As built (2026-10-15):**
- **Files:** the named schema, routes, controller, service and tests (`items.routes.test.ts`, like categories), plus `items.model.ts` (the queries), a shared schema test, the export in `shared/src/index.ts` and the `/items` registration. Overview §8 and its error-code table are updated (`DUPLICATE_BARCODE` added; `DUPLICATE_CODE` now also covers item codes). No `lib` change, no migration, no new package.
- **Open choices:** reads need `stock:read`, the lookup `bill:create` (overview §8) and writes `item:write`, so an Admin gets 403 on all of them (on the list: `NO_ACTIVE_BRANCH`). One `PATCH /items/:id` edits and, with `isActive`, deactivates or reactivates; it is audited as `item.update` / `item.deactivate` / `item.activate`, like branches. A category that is missing or belongs to another branch answers 422 on `categoryId`. The list takes `search`, `categoryId` and `active`; without `active` it returns active and inactive items. `code` and `barcode` match exactly, with case kept (the 3.1 index is case-sensitive). Prices are whole paise from 0 to ₹1 crore; a selling price above the MRP is a 422 on the selling price (on the MRP when only the MRP is lowered). `reorderLevel` is accepted; `hsnCode` and `gstRate` stay out of the API (PD-01). A duplicate is caught by the unique index and told apart (code or barcode) after the rollback.
- **Run once:** lint, format check and type check clean, and both new test files green on the first run (75 route tests, 39 schema tests). The full gate was not run.
- **Proven by breaking it once (10):** create in one transaction, the stock row at 0, the three permission checks (POST, PATCH, lookup), branch isolation on edit, list and lookup, lookup skipping deactivated items, the price rule on edit. **Not proven (6):** audit rows, the duplicate-to-code/barcode mapping (two cases), the `%`/`_` search escaping, the category check and the shared schema's price rule. I stopped the run when option 3 (run nothing per task) was chosen; their tests are written and passed once.

---

## Task 3.5 — Vendors API

**Goal:** cashiers manage their branch's vendors.

**Files:** `shared/src/schemas/vendors.ts`, `backend/src/modules/vendors/vendors.{routes,controller,service,test}.ts`

**Steps:**
1. **Red** — tests:
   - List (search by name), create, edit, deactivate.
   - `gstin` is optional, but when given must be 15 characters in the GSTIN pattern.
   - Branch isolation; Admin 403 on write.
2. **Green** — implement.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(catalog): add vendors api`

---

## Task 3.6 — Stock read API

**Goal:** current stock and the movement history of an item can be viewed.

**Files:** `shared/src/schemas/stock.ts`, `backend/src/modules/stock/stock.{routes,controller}.ts`, `stock.routes.test.ts`

**Steps:**
1. **Red** — tests:
   - `GET /stock` lists items with quantity; filter by `categoryId`; paginated.
   - `GET /stock/:itemId/movements` returns the ledger newest first, paginated, with type, quantity, `balance_after`, reason, who and when.
   - A cashier sees only the active branch.
   - The Admin can read any branch with `?branchId=`.
2. **Green** — implement.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(stock): add stock and movement history api`

---

## Task 3.7 — CSV import

**Goal:** the Admin imports a branch's items and opening stock from a CSV file (D-24).

**Read first:** overview §7.1 (CSV format — proposed).

**Files:** `shared/src/schemas/import.ts`, `backend/src/modules/import/import.{routes,controller,service,test}.ts`, `backend/test/fixtures/import/*.csv`

**Steps:**
1. Install `csv-parse`.
2. The route `POST /admin/branches/:id/import` takes the file as the request body with `Content-Type: text/csv` (`express.text`, 5 MB limit), so no upload package is needed.
3. Header row required: `code,barcode,name,category,mrp,selling_price,reorder_level,opening_stock`.
4. **Red** — tests with fixtures:
   - **Valid 5-row file:** creates the missing categories, the items, their `item_stock`, and an `opening` movement (`refType: import`) per item with stock > 0. Returns counts.
   - **Errors:** a bad price, missing name, duplicate code within the file, a code that already exists in the branch, or negative stock → 422 with **every** error as `[{ row, column, message }]`, and **nothing saved**.
   - **1,000-row file:** imports in under 10 seconds; the ledger matches stock.
   - One audit row per import, with counts.
   - Cashier → 403.
5. **Green** — implement:
   1. Parse.
   2. Validate every row with a zod row schema, using `rupeesToPaise`.
   3. Check duplicates against the file and the database.
   4. If there are no errors, run one transaction: categories, then items, then stock via `postMovements`.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(import): add csv import for items and opening stock`

---

## Task 3.8 — Dev seed script

**Goal:** one command fills the dev database with realistic demo data, for manual testing in later phases.

**Files:** `backend/src/scripts/seed-dev.ts`; root script `db:seed`

**Steps:**
1. The script refuses to run when `NODE_ENV=production`.
2. It creates:
   - client settings
   - one Admin and two cashiers (printing their passwords)
   - branches `TPR` and `CBE`
   - 5 categories
   - 50 items per branch with barcodes and prices
   - opening stock, imported through the same import service from Task 3.7
3. It is idempotent: a second run reports "already seeded" and exits.

**Done when:**
- [ ] `npm run db:seed` on a fresh dev database works
- [ ] A second run exits cleanly

**Commit:** `chore(dev): add dev seed script`

---

## Task 3.9 — Frontend: items, categories, vendors

**Goal:** cashiers manage the catalog from the browser.

**Read first:** overview §4.6.

**Files:** `frontend/src/pages/items/*`, `frontend/src/pages/categories/*`, `frontend/src/pages/vendors/*`, `en.ts`

**Steps:**
1. **Items:**
   - Search box, paginated list with stock and category filter.
   - Create/edit form: prices entered in rupees and converted with `rupeesToPaise`; validated with the shared zod schemas.
   - Deactivate with a confirmation dialog.
2. **Categories:** list, create, rename.
3. **Vendors:** list, search, create, edit, deactivate.
4. Show server errors (duplicate code or barcode, price rule) next to the relevant fields.

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check on seeded data: create, edit, search, deactivate

**Commit:** `feat(frontend): add items, categories and vendors screens`

---

## Task 3.10 — Frontend: stock and import screens

**Goal:** stock is visible, with each item's history, and the Admin can run the CSV import.

**Files:** `frontend/src/pages/stock/*`, `frontend/src/pages/admin/ImportPage.tsx`, `frontend/public/import-template.csv`, `en.ts`

**Steps:**
1. **Stock:** list with category filter; clicking an item opens its movement history.
2. **Import (Admin):**
   - Choose a branch and pick a CSV file; the browser reads it as text and posts it.
   - On 422, show the error table (row, column, message). On success, show the counts.
   - Link to download `import-template.csv`.

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check: import a valid file and a broken file

**Commit:** `feat(frontend): add stock and import screens`

---

## 🛑 Checkpoint 3

Agent: follow the checkpoint steps in `README.md`.

**Checkpoint review (user):**
- [ ] Import a CSV of 20 real items from the store, using the template
- [ ] Check the stock list against the file; open the movement history of one item
- [ ] Change an item's price, and check the change appears in history/audit
- [ ] Confirm the (proposed) items: the CSV columns, all-or-nothing import, selling price not above MRP
