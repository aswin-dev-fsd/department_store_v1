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
- [x] All tests pass (first run: Checkpoint 3, 2026-10-15)

**Commit:** `feat(catalog): add vendors api`

**As built (2026-10-15):**
- **Files:** the named schema, routes, controller, service and tests (`vendors.routes.test.ts`, like categories and items), plus `vendors.model.ts` (the queries), a shared schema test, the export in `shared/src/index.ts`, the `/vendors` registration, a `createVendor` fixture and the overview §8 rows. No `lib` change, no migration, no new package.
- **Open choices:** all three routes need `vendor:write` (overview §8 names no other permission), so an Admin gets 403 `FORBIDDEN` on the list too. One `PATCH /vendors/:id` edits and, with `isActive`, deactivates or reactivates; it is audited as `vendor.update` / `vendor.deactivate` / `vendor.activate`. The list takes `search` (any part of the name, any case) and `active` (left out: both), ordered by name. `name` is 1–100 characters; `phone` (up to 20), `address` (up to 200) and `gstin` are optional and cleared with null or a blank value. A GSTIN is typed in any case, stored upper-case and must match the 15-character pattern (2 digits, 5 letters, 4 digits, a letter, a letter or digit 1–9, `Z`, a letter or digit); its check character is not verified. Vendor names are not unique (the table has no such index and the task doesn't ask for one).
- **Not run:** under option 3 nothing was run for this task: 47 route tests and 39 schema tests are written, but lint, types, format and the tests first run at Checkpoint 3 (`npm run format` may be needed then: Prettier was not run). The "tests pass" box above stays open until then. Two small pieces that first existed twice, in items and vendors (the LIKE-escape helper and the `search` / `active` query fields), were shared afterwards at your request in a separate commit: `backend/src/lib/like.ts`, and `searchTextSchema` / `activeFilterSchema` in `shared/src/schemas/common.ts` (items and vendors use them; `branches.ts` and `users.ts` still carry their own copy of the `true|false` filter).

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
- [x] All tests pass (first run: Checkpoint 3, 2026-10-15)

**Commit:** `feat(stock): add stock and movement history api`

**As built (2026-10-15):**
- **Files:** the named schema, routes, controller and tests, plus read functions **appended** to the existing `stock.service.ts` and `stock.model.ts` (`postMovements` and the write queries are untouched; the model's header comment now says the writes take a transaction and the reads any connection), a shared schema test, the shared export, the `/stock` registration and the overview §8 rows. No `lib` change, no migration, no new package.
- **Open choices:** both roles have `stock:read`. A cashier reads the branch they work in; naming it with `?branchId=` is accepted, naming another is 403 `FORBIDDEN`. Someone with `report:all` (the Admin, who works in no branch) must name it: missing is 422 on `query.branchId`, unknown is 404, a deactivated branch can be read. I used `report:all` because it is the permission that already means "any branch" (overview §8); the rule sits in `branchToRead` in the controller, next to the handlers, because it reads the request like `activeBranchId`. `GET /stock` lists every item of the branch, active or not (`isActive` says which), by name ignoring case; its only filter is `categoryId`, as the task says. Movements come newest first **by row id, not by time**: the id is the order the stock lock applied them in, which is the order `balance_after` follows (a test moves a clock time to prove it). Each row carries `type`, `quantity`, `balanceAfter`, `reason`, `createdBy {id, fullName}` and `createdAt` as the task names, plus `note`, `refType` and `refId`; the batch and expiry columns (PD-02) stay out. The movement types, reference types and reasons are added to `@ds/shared` as lists, with a backend test that they equal the database enums (as for roles).
- **Not run:** under option 3 nothing was run for this task: 44 route tests and 26 schema tests are written, but lint, types, format and the tests first run at Checkpoint 3 (`npm run format` may be needed then). The "tests pass" box above stays open until then.

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
- [x] All tests pass (first run: Checkpoint 3, 2026-10-15)

**Commit:** `feat(import): add csv import for items and opening stock`

**As built (2026-10-15):**
- **Files:** the named schema, routes, controller, service and tests (`import.routes.test.ts`, like the other modules) and three fixtures (`valid-5-rows.csv`, `errors.csv`, `missing-column.csv`; the 1,000-row file is generated inside the test), plus `import.model.ts` (the queries), a shared schema test, the shared export, the overview rows and error codes, and the route registration, placed **ahead of** the branches routes so the import answers its own path with `admin:import` rather than inheriting `admin:branches`. No `lib` change, no migration. `csv-parse` 7.0.3 is installed in `@ds/backend`, pinned exactly (an approved package; the install ran after your go-ahead in the session).
- **Open choices:**
  - *The file:* the columns may come in any order and letter case, other columns are ignored, and a byte order mark or CRLF line ends are fine. `code` and `name` are required; the other cells may be blank, a blank `opening_stock` is 0, and only an item with stock above 0 gets an `opening` movement. A row with more values than the header (an unquoted comma) is an error. Rows count from 1 for the header, and blank lines are skipped but still counted, so a row number is the line in the file.
  - *The checks:* the same rules as the items API (a selling price above the MRP is an error), plus a barcode repeated in the file or already in the branch, which would otherwise be a database error. A code or barcode repeated in the file, or already in the branch, is reported on every row it affects, with the other problems of the file. Each cell reports its first problem only.
  - *Categories:* matched by name in any letter case; an existing one is reused, a missing one is created once, spelt as first seen in the file.
  - *The answers:* 201 with `{ categoriesCreated, itemsCreated, openingMovements }`; 422 `IMPORT_INVALID` with every `{ row, column, message }` (`column` is null for a problem with the whole row or file); 415 `CSV_REQUIRED` for a body that is not `text/csv`; 413 for a file over 5 MB; 400 `IMPORT_CONFLICT` when another change collided while saving (nothing saved, never a 500). One `branch.import` audit row with the counts.
  - *Speed:* rows go in batches of 500 per statement, so 1,000 rows take about 20 round trips to the database, far inside the 10 seconds asked for and the 30-second proxy limit noted in the pending decisions. A file of tens of thousands of rows (the 5 MB cap) needs proportionally more round trips and was not measured.
- **Not run:** under option 3 nothing was run for this task except the package install: 25 route tests and 30 schema tests are written, but lint, types, format and the tests first run at Checkpoint 3. I read `csv-parse` 7's source for the behaviours the tests rely on: an empty line is a record, a trailing newline is not, an unclosed quote throws, and `relax_column_count` does not throw. The "tests pass" box above stays open until the checkpoint.

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

**As built (2026-10-15):**
- **Files:** `backend/src/scripts/seed-dev.ts` (the logic, exported and tested) and `seed-dev.cli.ts` (the thin executable), as for the other operator scripts, plus `seed-dev.test.ts`, the backend and root `db:seed` scripts, and a section and command row in `docs/dev-setup.md`. No new package, no migration.
- **Open choices:**
  - *How it works:* it calls the real services, so passwords, audit rows and rules are the real ones: `setupClient` (settings and the Admin), `createBranch`, `createUser`, `setUserBranches`, and the Task 3.7 `importItems` for each branch (which creates the categories, items, stock rows and `opening` movements). Passwords are generated temporary ones, printed once by the CLI and never stored or logged; each account must change its password at first login, like `setup:client`.
  - *The data:* `admin`; `cashier1` works in TPR only; `cashier2` in TPR and CBE (to try the branch picker). Both branches sell the same 50 products, 10 in each of Grocery, Beverages, Personal care, Household and Stationery, with EAN-13 barcodes and rupee prices (selling price at or below the MRP). Opening stock is a fixed formula, so every run gives the same data: 50 to 99 packs, but 3 items sold out and 4 below their reorder level in each branch (different items in each), so 47 items per branch get an `opening` movement.
  - *The guards:* it refuses when `NODE_ENV=production`; if branches `TPR` and `CBE` both exist it answers "already seeded", exit 0, changing nothing; and **(my addition)** if the database has any other data (a user, the client settings or a branch) it refuses with `NOT_EMPTY`, changing nothing, so demo data can never mix into a real database. The run is several transactions, not one: if it stops half-way, empty the database and run it again.
- **Not run:** under option 3 nothing was run for this task: 23 tests are written (9 on the catalogue without a database, 9 on a real seeding of the test database, 5 on the refusals), but lint, types, format and the tests first run at Checkpoint 3. Both "Done when" boxes stay open: running `npm run db:seed` on a fresh dev database is a write to the dev database, so it waits for your go-ahead (and an empty database).
- **Changed at Checkpoint 3 (2026-10-17), at your request:** the three accounts now have fixed dev passwords instead of generated temporary ones, and no password change is forced at the first login. After creating each account the seed does the first-login step itself, through the real `changePassword` service: the generated temporary password is replaced by the fixed one (hashed like any other, one `auth.password_change` audit row per account, `must_change_password` cleared). The passwords are in `seed-dev.ts` and `docs/dev-setup.md`, and the choice is recorded as D-32. Because they are weak and public, the guards carry the weight: the seed refuses `NODE_ENV=production` and any database that already has data, so staging after `setup:client` is refused. The seed tests were changed to match: the flag, the fixed passwords and their hashes, the password rules, and one more audit action.

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
- [x] check-types and build pass (Checkpoint 3, 2026-10-17)
- [ ] Manual check on seeded data: create, edit, search, deactivate

**Commit:** `feat(frontend): add items, categories and vendors screens`

**As built (2026-10-15):**
- **Files:** the six pages (`pages/items/{ItemsPage,ItemForm}.tsx`, `pages/categories/{CategoriesPage,CategoryForm}.tsx`, `pages/vendors/{VendorsPage,VendorForm}.tsx`) and the labels in `en.ts`, plus the layer behind them in `frontend/src/catalog/` (query keys, list queries and API paths, mutations, form conversions, sections: the same split as `admin/`) with 68 logic tests, `components/{CatalogLayout,SearchBox}.tsx`, `pages/CatalogHomePage.tsx`, the routes in `App.tsx` and one "Catalog" link in `AppShell.tsx`. No new package.
- **Open choices:**
  - *Where:* a Catalog area at `/catalog` with a sub-menu (Items, Categories, Vendors), like Administration. The header link shows for anyone with `item:write`; each section checks its own permission, and `/catalog` opens the first section the person may use. The Admin has none of these permissions, so sees no Catalog link.
  - *Lists:* cards like the Admin screens, 20 per page. Items: search by name, code or barcode, a category filter and a status filter (Active only, the default; Inactive only; both). Vendors: search by name and the same status filter. Categories: a plain list. A search runs when you press Enter or Search, not on every keystroke, to spare a slow connection.
  - *The item form:* prices are typed in rupees and converted with `rupeesToPaise`, then checked by the shared schemas (selling price at or below the MRP). A price or reorder level that is not a number gets its own plain message ("Write the price in rupees, like 145.50"). Server errors land next to their fields: `DUPLICATE_CODE` on the code, `DUPLICATE_BARCODE` on the barcode, the price rule on the selling price, a bad category on the category. The code stays editable, because the API allows it.
  - *Deactivate* asks first, with the same inline confirm bar as branches and users; *Reactivate* is one click. The category drop-down lists up to 100 categories (the API's largest page).
  - *One existing label changed:* `error.DUPLICATE_CODE` read "Another branch already uses this code." and now reads "That code is already in use.", because item codes raise the same error code.
- **Not run:** under option 3 nothing was run for this task. The logic is covered by 68 tests (API paths, form conversions against the shared schemas, mutations and their refreshes, sections), but the screens themselves have no automated tests (there is no component-test package, as before), so types, lint, format, build and tests first run at Checkpoint 3, and the first real look at these screens is the manual check. Both "Done when" boxes stay open: that check needs the dev servers and a seeded dev database (waiting for your go-ahead on the seed).

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
- [x] check-types and build pass (Checkpoint 3, 2026-10-17)
- [ ] Manual check: import a valid file and a broken file

**Commit:** `feat(frontend): add stock and import screens`

**As built (2026-10-15):**
- **Files:** `pages/stock/{StockPage,MovementsPanel}.tsx`, `pages/admin/ImportPage.tsx`, `frontend/public/import-template.csv` and the labels in `en.ts`, plus: `frontend/src/stock/` (API paths, query keys, queries, display helpers), `admin/import.ts` (the import call and the reading of its 422 problems), `lib/dates.ts` (times in Indian time), a `postCsv` call in `api/client.ts` (the import sends raw `text/csv`, which the JSON-only client could not), an **Import section** in `admin/sections.ts` (so it gets its hub card, sub-menu entry and route from the one list; its existing test was updated), the routes in `App.tsx`, a "Stock" link in `AppShell.tsx`, and an `enabled` flag on `useCategoryOptions`. 23 logic tests. No new package.
- **Open choices:**
  - *Stock:* `/stock` for cashiers (their branch) and the Admin (who chooses the branch from a drop-down of active branches). Cards with the number in stock; **Show history** opens the movement table inline (when, what, change, balance after, reason or note, who), 20 per page, times in Indian time. A cashier can filter by category. A **Low stock** badge (my addition) shows when stock is at or below the reorder level.
  - *Known gap:* the categories API cannot be asked about another branch, so the Admin's stock list has no category filter and no category names. A small backend change (for example the category name in each stock row, or `?branchId=` on categories) would close it; it is not done.
  - *Import:* Administration → Import. Choose a branch, pick the file, press "Import into TPR". Success shows the counts; a 422 shows the table of Row, Column and Problem; any other failure shows a message (`IMPORT_CONFLICT`, a file over 5 MB and a non-CSV file have their own wording). The page explains the file format and links the template, which holds the header and two example rows marked "delete this row". The problem messages are shown as the server wrote them (English), not through the dictionary.
- **Not run:** under option 3 nothing was run for this task. The logic is covered by 23 tests (API paths, query keys, the low-stock rule, Indian-time formatting, the import call and its refreshes, reading the 422 problems, the new client call), but the screens have no automated tests, so types, lint, format, build and tests first run at Checkpoint 3, and the first real look at these screens is the manual check. Both "Done when" boxes stay open: that check needs the dev servers and a seeded dev database (waiting for your go-ahead on the seed), plus a valid CSV file and a broken one.

---

## 🛑 Checkpoint 3

Agent: follow the checkpoint steps in `README.md`.

**Checkpoint review (user):**
- [ ] Import a CSV of 20 real items from the store, using the template
- [ ] Check the stock list against the file; open the movement history of one item
- [ ] Change an item's price, and check the change appears in history/audit
- [ ] Confirm the (proposed) items: the CSV columns, all-or-nothing import, selling price not above MRP
