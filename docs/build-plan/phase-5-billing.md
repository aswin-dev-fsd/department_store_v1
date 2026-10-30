# Phase 5 — Billing

**Goal:** the billing counter: fast item entry, split payments, gapless bill numbers, cancellation, and an 80mm receipt. This phase holds the money core, so it has an extra checkpoint (5A) before any billing screen is built.

**Read first for the whole phase:** overview §6.2–6.6 (billing rules), §7.3–7.4 (billing and cancel workflows); `AGENTS.md` → Money, Bill numbers, Time; D-13 to D-18.

---

## Task 5.1 — Billing tables

**Goal:** the customer and bill tables exist.

**Read first:** `docs/implementation_plan.md` → Data model; overview §5.2 "Documents" and `customers`.

**Files:** `database/src/schema/billing.ts`, `database/src/schema/customers.ts`, `schema/index.ts`, a generated migration

**Steps:**
1. Tables: `customers`, `bills`, `bill_lines`, `bill_payments`, `bill_sequences`.
2. Enums: `bill_status` (`completed`, `cancelled`), `payment_mode` (`cash`, `upi`, `card`).
3. Constraints:
   - unique `bills.bill_no`
   - unique `bills (branch_id, fy, seq)`
   - `bill_sequences` primary key `(branch_id, fy)`
   - `bill_lines.quantity > 0`, `discount_paise >= 0`
   - `bill_payments.amount_paise > 0`
   - unique `customers.phone`
4. Indexes: `bills (branch_id, bill_date)`, `bills (cashier_id, bill_date)`, `bills (customer_id)`.
5. Nullable tax columns on `bill_lines` and `bills` (PD-01).
6. Generate, **read the SQL**, apply.

**Done when:**
- [x] The migration applies to an empty database
- [x] check-types passes

**Commit:** `feat(database): add billing and customer tables`

**Checked at Checkpoint 5A (2026-10-30):** the local test database was emptied and `runMigrations` applied all four migrations (18 tables); a second run changed nothing. The 25 schema tests pass on Neon and on local PostgreSQL.

**As built (2026-10-30):**
- **Files:** `database/src/schema/billing.ts` (the two enums, `bills`, `bill_lines`, `bill_payments`, `bill_sequences`), `customers.ts`, `schema/index.ts`, migration `0003_billing_and_customers.sql` (+ snapshot and journal), and `backend/test/schema/billing.schema.test.ts` (25 tests, raw SQL).
- **The SQL, read line by line:** it only adds (2 enums, 5 tables, 8 foreign keys, 3 CHECKs, 3 unique constraints, 3 indexes); nothing hand-written.
- **Choices the task left open:** columns as in overview §5.2 "Documents" and `customers`; every foreign key `ON DELETE RESTRICT`, like the earlier phases; the money columns are required with no default, because the server always computes them; `fy` is text like `26-27`; `bill_date` is a `date` (the IST business date); bills have no `updated_at` (a bill is only ever cancelled, and the cancel fields record when); the GST columns copy the items' types (`hsn_code` text, `gst_rate` numeric(5,2)), all nullable (PD-01).
- **Applied to:** the dev database (on top of 0000–0002). Staging gets it at Render's next build.
- **Not run:** under option 3 the 25 tests, check-types and the empty-database apply wait for Checkpoint 5A, so both "Done when" boxes stay open.
- **Not in the task, so not built (proposed for you):** unique `bill_lines (bill_id, line_no)`; indexes on `bill_lines (bill_id)` and `bill_payments (bill_id)` (PostgreSQL doesn't index foreign keys, and both are read by bill); a CHECK that `customers.phone` is 10 digits (Task 5.4 normalises it in the service); non-negative CHECKs on the bill amounts.

---

## Task 5.2 — Billing math helpers

**Goal:** pure, fully tested functions for bill totals, financial year, business date and bill number format. The frontend uses them for the live preview; the backend uses them for the real totals.

**Read first:** overview §6.3, §6.4 (worked example), §5.4.

**Files:** `shared/src/billing.ts`, `shared/src/billing.test.ts`, `shared/src/dates.ts`, `shared/src/dates.test.ts`

**Steps:**
1. **Red** — tests:
   - **Totals:** `computeBill(lines)` reproduces the overview §6.4 worked example exactly: subtotal 105575, discount 2000, round-off +25, total 103600.
   - **Round-off:** net ₹100.50 → ₹101 (+50); ₹100.49 → ₹100 (−49); ₹100.00 → round-off 0.
   - **Discount limits:** a line discount larger than the line amount throws; a negative discount throws; quantity must be a whole number ≥ 1.
   - **Financial year:** `financialYear(new Date('2027-03-31T18:29:59Z'))` → `'26-27'` (23:59:59 IST, 31 March); `financialYear(new Date('2027-03-31T18:30:00Z'))` → `'27-28'` (00:00 IST, 1 April).
   - **Business date:** `businessDate(new Date('2026-10-12T18:00:00Z'))` → `'2026-10-12'` (11:30 PM IST); `businessDate(new Date('2026-10-12T18:30:00Z'))` → `'2026-10-13'`.
   - **Bill number:** `formatBillNo('TPR', '26-27', 123)` → `'TPR/26-27/000123'`; the result is never longer than 16 characters; a sequence above 999999 throws.
2. **Green** — integer arithmetic only.
   - IST is a fixed UTC+05:30 offset (India has no daylight saving), so no date library is needed.

**Done when:**
- [x] All tests pass

**Commit:** `feat(shared): add billing math, financial year and bill number helpers`

**As built (2026-10-30):**
- **Files:** the four named, plus the exports in `shared/src/index.ts`.
- **`computeBill(lines)`** takes `{ unitPricePaise, quantity, discountPaise }` per line (the price is the item's, looked up by the server) and returns each line's amount and total, then the subtotal, discount, signed round-off and total. The round-off is applied to subtotal − discount. `computeLine` and `roundToRupee` are exported for the screen's per-line preview.
- **Rounding:** to the nearest rupee, exactly 50 paise up (overview §6.4, proposed).
- **Refusals:** bad input throws `RangeError`: a quantity that is not a whole number ≥ 1, a negative or part-paise price or discount, a discount above the line amount, a sum that would no longer be exact, a bill sequence outside 1–999999, or a bill number over 16 characters (a branch code over 3 letters). Task 5.5 turns these into 422s.
- **Dates:** `businessDate` and `financialYear` shift by the fixed IST offset and read the UTC fields; an invalid date throws `RangeError`.
- **Not run:** under option 3 the 45 tests are written but not run; the box is ticked at Checkpoint 5A.

---

## Task 5.3 — Bill number allocation

**Goal:** gapless bill numbers per branch per financial year, safe across counters.

**Read first:** D-15; `AGENTS.md` → Bill numbers.

**Files:** `backend/src/modules/bills/bill-number.service.ts`, `bill-number.service.test.ts`

**Steps:**
1. **Red** — tests for `allocateBillSeq(tx, branchId, fy)`:
   - The first call for a branch/year → 1, then 2, then 3.
   - A new financial year starts again at 1. Another branch has its own sequence.
   - **Rollback:** a call inside a transaction that rolls back → the next committed call reuses that number, so there's no gap.
   - **Concurrency:** 50 parallel transactions → numbers exactly 1–50, no duplicates, no gaps.
2. **Green** — one statement:
   ```sql
   INSERT INTO bill_sequences (branch_id, fy, last_seq) VALUES ($1, $2, 1)
   ON CONFLICT (branch_id, fy) DO UPDATE SET last_seq = bill_sequences.last_seq + 1
   RETURNING last_seq
   ```

**Done when:**
- [x] All tests pass
- [x] The concurrency test passes 10 runs in a row

**Commit:** `feat(bills): add gapless bill number allocation`

**As built (2026-10-30):**
- **Files:** the two named. The single query is in the service rather than a model file, because the task names only the service and the query is the whole service.
- **How it is safe:** the upsert inserts the row at 1 or adds 1 to it; either way the row stays locked until the bill's transaction ends, so a second counter waits for the first to commit or roll back. A rolled-back bill takes its number back with it.
- **Tests (16):** the four the task lists, with the concurrency test as 10 runs of 50 parallel transactions (each holds the lock 10 ms, so they really queue); plus a rollback of the very first bill of a year (no row left, the next bill is 1), and 20 parallel bills with 5 failing (the 15 saved get 1–15).
- **Not run:** under option 3 the tests are written but not run; both boxes are ticked at Checkpoint 5A.

---

## Task 5.4 — Customer lookup

**Goal:** a phone number finds an existing customer or creates a new one.

**Read first:** D-08, D-18; overview §6.9.

**Files:** `shared/src/schemas/customers.ts`, `backend/src/modules/customers/customers.{routes,controller,service,test}.ts`

**Steps:**
1. **Red** — tests:
   - `normalisePhone`: `'+91 98765 43210'`, `'09876543210'` and `'9876543210'` all become `'9876543210'`. Anything that isn't a 10-digit Indian mobile number starting with 6–9 → 422.
   - `findOrCreateByPhone(tx, phone, name?)`: creates once, then returns the same customer; fills in the name if it was missing.
   - `GET /customers/lookup?phone=` → the customer, or 404. Customers are client-wide: a cashier in another branch finds the same customer.
2. **Green** — implement.

**Done when:**
- [x] All tests pass

**Commit:** `feat(customers): add customer lookup`

**As built (2026-10-30):**
- **Files:** the named shared schema, routes, controller, service and test (`customers.test.ts`: the route and the service against the test database), plus `customers.model.ts`, a shared schema test, the export in `shared/src/index.ts` and the `/customers` registration.
- **`normalisePhone`:** spaces, dashes, dots and brackets are dropped and a leading `+91`, `91` (12 digits) or `0` (11 digits) removed; the result must be 10 digits starting 6–9, or it is refused (null, and 422 through `phoneSchema`). Landlines are refused, as the task says.
- **`GET /customers/lookup?phone=`:** `bill:create`; no active branch needed, because customers are client-wide. It finds, or answers 404; it never creates.
- **`findOrCreateByPhone(tx, phone, name, by)`:** runs in the bill's transaction (Task 5.5). `INSERT … ON CONFLICT (phone) DO NOTHING`, then reads the row, so two counters creating one phone get the same customer. A name fills in a missing one, never replaces a known one. **Deviation:** a 4th argument `by` (`actorId`, `branchId`, `ip`) the task's signature lacks, because creating or naming a customer is a write and D-30 audits it (`customer.create`, `customer.update`).
- **Not run:** under option 3 the 17 route and service tests and 25 schema tests are written but not run.
- **Not in the task, so not built (proposed for you):** editing a customer's name or phone later (a known name is never changed at the counter).

---

## Task 5.5 — Create a bill

**Goal:** `POST /bills` saves a complete bill in one transaction, exactly as overview §7.3 describes.

**Read first:** overview §7.3 step 4; `docs/implementation_plan.md` → Bill creation transaction.

**Files:** `shared/src/schemas/bills.ts`, `backend/src/modules/bills/bills.{routes,controller,service}.ts`, `bills.create.test.ts`

**Request:** `{ lines: [{ itemId, quantity, discountPaise }], payments: [{ mode, amountPaise }], customer?: { phone, name? } }`. Any price field sent by the client is rejected by the strict schema.

**Steps:**
1. **Red** — tests:
   1. **Happy path** → 201:
      - `bill_no` is `TPR/26-27/000001`, with the correct `fy` and IST `bill_date`.
      - Lines snapshot the item name, code, MRP and unit price.
      - Totals equal `computeBill`. Payments are saved.
      - One `sale` movement per item (`refType: bill`). Stock is reduced.
   2. **Insufficient stock** → 400 `INSUFFICIENT_STOCK` with item details. **Nothing saved**, and the next successful bill still gets `000001`.
   3. **Payment mismatch:** payments ≠ total → 400 `PAYMENT_MISMATCH`, nothing saved.
   4. **No price tampering:** a request with a `unitPricePaise` field → 422. The price always comes from the item.
   5. **Bad items:** an inactive item, or one from another branch → 404, nothing saved.
   6. **Same item twice:** two lines of the same item are both saved, and stock is checked against the combined quantity.
   7. **Customer:** a phone creates or links the customer. With no customer, `customer_id` is null.
   8. **Concurrency:** stock 1, two parallel bills for it → one 201, one `INSUFFICIENT_STOCK`. Stock 0.
   9. **Concurrency:** 50 parallel valid bills → numbers 000001–000050, no gaps.
   10. **Permissions:** Admin → 403; a cashier with no active branch → 403.
   11. `assertLedgerMatchesStock` passes in every test.
2. **Green** — one transaction:
   1. `postMovements`, which locks the rows and checks stock.
   2. Load the items and their prices.
   3. `computeBill`.
   4. Check the payments.
   5. Customer.
   6. `allocateBillSeq`.
   7. Insert the bill, its lines and payments.

   `postMovements` needs the bill ID for `refId`. Insert the bill first, inside the same transaction, or pre-generate the ID. Whichever is chosen, a stock failure must still roll back everything, including the bill number.

**Done when:**
- [x] All tests pass
- [x] The concurrency tests pass 10 runs in a row

**Commit:** `feat(bills): add bill creation transaction`

**As built (2026-10-30):**
- **Files:** the named shared schema, routes, controller, service and test, plus `bills.model.ts` (the queries, including the bill view that Task 5.6 will reuse), a shared schema test, the export in `shared/src/index.ts` and the `/bills` registration.
- **The order in the transaction:** load the branch's active items with their prices (inactive, other-branch or unknown → 404); check each discount against its line (422 on `body.lines.N.discountPaise`); `computeBill`; payments must add up to the total exactly (400 `PAYMENT_MISMATCH`, `details: { totalPaise, paidPaise }`); find or create the customer; `allocateBillSeq`; insert the bill, its lines (name, code, MRP and unit price as snapshots) and payments; then `postMovements` with one `sale` per line and the bill's id as `refId`. The bill is inserted first so the movements can name it; a short item (`INSUFFICIENT_STOCK`, with the ledger's details) rolls back all of it, including the bill number and a new customer.
- **Locks:** a bill takes its branch's sequence row before the stock rows, so bills of one branch queue on the number; no other code path takes them in the other order, so they cannot deadlock.
- **Time:** the service takes the moment of the sale (`at`); the controller passes the server clock. That decides the FY and the IST `bill_date`, and lets the 31 March / 1 April test call the service with fixed times.
- **Choices the task left open:** a left-out discount is 0; one payment row per mode (the same mode twice is a 422); a payment of 0 is refused (the database CHECK too); caps of 10,000 packs a line and 200 lines.
- **Not run:** under option 3 the 47 route tests (the two concurrency tests as 10 runs each) and 20 schema tests are written but not run; both boxes are ticked at Checkpoint 5A.

---

## Task 5.6 — Cancel, list, view and receipt data

**Goal:** bills can be found, viewed, cancelled with a reason, and their receipt data fetched. Branch codes become fixed once a branch has bills.

**Read first:** overview §6.6, §7.4; D-14.

**Files:** `bills.service.ts`, `bills.routes.ts`, `bills.cancel.test.ts`, `bills.read.test.ts`; `branches.service.ts` (the `TODO(5.6)` from Task 2.8)

**Steps:**
1. **Red** — tests:
   - **Cancel:** `POST /bills/:id/cancel { reason }` → status `cancelled`, cancel fields set; one `sale_cancel` movement per line; stock restored. The bill number is unchanged. An audit row is written.
   - Cancelling twice → 400 `DOCUMENT_LOCKED`. A reason is required.
   - **List:** `GET /bills` filters by date, bill number, customer phone and cashier; own branch only; paginated.
   - **View:** `GET /bills/:id` includes lines and payments.
   - **Receipt:** `GET /bills/:id/receipt` returns everything the receipt prints: client settings, branch name/address/footer, bill number, date/time in IST, cashier name, lines, totals, round-off, payments, and status.
   - **Branch code:** once a branch has a bill, changing its code → 400 `CODE_LOCKED`.
2. **Green** — implement, and remove the `TODO(5.6)`.

**Done when:**
- [x] All tests pass

**Commit:** `feat(bills): add bill cancel, lookup and receipt data`

**As built (2026-10-30):**
- **Files:** the named service, routes and two tests, and `branches.service.ts` (the `TODO(5.6)` replaced); plus `cancelBillSchema`, `listBillsQuerySchema`, `BillSummary` and `Receipt` in `shared/src/schemas/bills.ts` (with schema tests and exports), the queries in `bills.model.ts`, `branchHasBills` in `branches.model.ts`, the controller handlers, and a `CODE_LOCKED` row in the overview's error codes.
- **Cancel:** one transaction: lock the bill (branch-scoped), check it is completed (`DOCUMENT_LOCKED` otherwise, so two parallel cancels put the stock back once), `postMovements` with one `sale_cancel` per line, mark cancelled, audit `bill.cancel` with the bill number. Reason 3–200 characters, as for purchases.
- **List:** newest first by save time; `from`/`to` compare the business date (both ends included); `billNo` matches any part, ignoring case (wildcards escaped); `phone` is normalised like at the counter; `cashierId` and `status` filters.
- **Receipt:** the data only; the screen prints it (Task 5.9). `issuedAtIst` is the save time as `DD-MM-YYYY HH:MM` in IST, worked out with the fixed offset like the business date.
- **Branch code:** locked once the branch has any bill, cancelled ones included, because their numbers carry the code. Other edits, and sending the same code, still work.
- **Not run:** under option 3 the 30 route tests and 11 schema tests are written but not run; the box is ticked at Checkpoint 5A.

---

## 🛑 Checkpoint 5A — money core review

Agent: run the checkpoint steps in `README.md`, and also write a **traceability table** in the checkpoint summary. It has one row per rule in overview §6.2–6.6, and names the test that proves the rule. Any rule without a test is a gap: add the test before stopping.

**Checkpoint review (user):**
- [ ] Read the traceability table: every billing rule has a test
- [ ] Optionally, create a bill and cancel it with a REST client (e.g. Thunder Client), and look at the database rows
- [ ] Say go before the billing screens are built

---

## Task 5.7 — Billing screen I: item entry

**Goal:** the cashier builds a bill quickly with scanner, code or name search.

**Read first:** overview §4.6 "Billing screen behaviour (proposed)".

**Files:** `frontend/src/pages/billing/BillingPage.tsx`, `BillLinesTable.tsx`, `useBillDraft.ts` + `useBillDraft.test.ts`; reuses `ItemPicker` from Task 4.5; `en.ts`

**Steps:**
1. **Red** — tests for `useBillDraft` (pure state logic):
   - Adding the same item again adds 1 to its quantity.
   - Changing quantity or discount recalculates totals with the shared `computeBill`.
   - Removing a line works.
   - The draft resets after save.
2. **Green** — implement:
   - The page opens with the cursor in the scan/search box, and focus returns there after every add.
   - Barcode or code + Enter does an exact lookup and adds the item; "not found" shows a short message and keeps focus.
   - Typing letters shows name results to pick with the arrow keys.
   - The lines table has editable quantity and discount (rupees) and a remove button.
   - Totals are always visible.
   - Show available stock per line, and a warning when quantity exceeds it. The server still decides.

**Done when:**
- [ ] Tests, check-types and build pass
- [ ] Manual check with a USB barcode scanner, or by typing barcodes and pressing Enter

**Commit:** `feat(frontend): add billing screen item entry`

---

## Task 5.8 — Billing screen II: payment and save

**Goal:** the cashier takes payment (including split), saves, and is ready for the next customer.

**Read first:** overview §6.5.

**Files:** `frontend/src/pages/billing/PaymentPanel.tsx`, `CustomerField.tsx`, `BillingPage.tsx`, `en.ts`

**Steps:**
1. **Payment panel:**
   - Amount fields for cash, UPI and card, plus a "rest in cash" quick fill.
   - Shows the remaining amount. Save is enabled only when the payments equal the total.
   - **Cash tendered** field: shows the change due. Only the bill amount is sent to the server.
2. **Customer (optional):** phone field with lookup; if no customer is found, a name field appears.
3. **Save:**
   - Send `POST /bills`.
   - `INSUFFICIENT_STOCK`: highlight the short lines with "available: N".
   - `PAYMENT_MISMATCH`: message in the payment panel.
   - Success: show the bill number, trigger the print (Task 5.9), reset the screen.
4. **Keyboard shortcuts (proposed):** F2 = focus search, F8 = payment panel, F9 = save. List them on screen.

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check: a single-mode bill, a three-way split bill, an insufficient-stock bill, a bill with a customer

**Commit:** `feat(frontend): add payment panel and bill save`

---

## Task 5.9 — Receipt printing

**Goal:** an 80mm thermal receipt prints after save and can be reprinted (PD-04).

**Files:** `frontend/src/pages/billing/Receipt.tsx`, `frontend/src/print/printReceipt.ts`, `frontend/src/print/receipt.css`, `docs/dev-setup.md` (printing section)

**Steps:**
1. `Receipt` renders from `GET /bills/:id/receipt`:
   - Header: business name, branch address and phone.
   - Bill number, date/time, cashier.
   - Lines: name, quantity × price, discount, line total.
   - Subtotal, discount, round-off, total, payments.
   - Branch footer. A **CANCELLED** banner when cancelled.
2. Print CSS: `@page { size: 80mm auto; margin: 0 }`, 72mm content width, monospace-friendly font. Long item names wrap.
3. `printReceipt(billId)` prints through a hidden iframe so the billing screen stays in place.
4. In `dev-setup.md`, document Chrome's `--kiosk-printing` flag for silent printing at the counter.

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check: print preview at 80mm looks right; prints on a real thermal printer if one is available (otherwise note it for Task 5.11)

**Commit:** `feat(frontend): add 80mm receipt printing`

---

## Task 5.10 — Bills screen

**Goal:** cashiers find, view, reprint and cancel bills.

**Files:** `frontend/src/pages/bills/*`, `en.ts`

**Steps:**
1. Search by bill number, date, or customer phone; paginated list showing status.
2. Detail view with lines and payments; **Reprint**; **Cancel** with a dialog requiring a reason, plus a confirmation that shows the bill number and total.
3. After a cancel, the status shows **Cancelled** and stock is restored (visible on the Stock screen).

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check: find, reprint, cancel

**Commit:** `feat(frontend): add bills screen with reprint and cancel`

---

## Task 5.11 — Counter acceptance test

**Goal:** a real-world run at a counter PC with a scanner and printer, led by the user and prepared by the agent.

**Files:** `docs/build-plan/acceptance-billing.md`

**Steps:**
1. The agent writes `acceptance-billing.md`: a numbered checklist with expected results, covering:
   - login
   - scanning 10 items, including a repeat scan
   - name search
   - a line discount
   - a split payment with cash change
   - an insufficient-stock attempt
   - print
   - reprint
   - cancel and re-bill
   - two counters billing the last unit at the same moment
   - a stock check afterwards
2. The agent seeds the dev database with `npm run db:seed`.
3. The user runs the checklist and marks pass/fail. The agent fixes failures — each fix as its own small commit with a test where possible.

**Done when:**
- [ ] Every checklist line passes and is recorded in the file

**Commit:** `test(billing): add counter acceptance checklist and results`

---

## 🛑 Checkpoint 5

Agent: follow the checkpoint steps in `README.md`.

**Checkpoint review (user):**
- [ ] The acceptance checklist is complete
- [ ] Confirm the (proposed) items: keyboard shortcuts, % discount entry, 50-paise rounding up, receipt layout
- [ ] Decide PD-04 (printer) if it's still open
