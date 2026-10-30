# Phase 6 — Adjustments and Reports

**Goal:** stock corrections with reasons, the four v1 reports with the right visibility for each role, and every UI label going through the dictionary.

**Read first for the whole phase:** overview §6.8 (adjustments), §6.10 (reports), §7.6–7.7; D-20, D-21, D-22, D-25.

**Report conventions:**
- Dates are IST business dates, using `businessDate` from Task 5.2.
- Cancelled bills and purchases never count in totals; they're listed separately.
- All amounts are in paise.

---

## Task 6.1 — Stock adjustments API

**Goal:** cashiers correct stock with a required reason.

**Files:** `shared/src/schemas/adjustments.ts`, `backend/src/modules/stock/adjustments.{routes,controller,service,test}.ts`

**Steps:**
1. **Red** — tests:
   - **Create:** `POST /stock/adjustments { itemId, quantity, reason, note? }` → one `adjustment` movement (`refType: adjustment`) with reason and note; stock changes.
   - **Quantity:** must be a whole number other than 0. Reason is one of the five enum values; `note` is required when the reason is `other`.
   - **Below zero:** an adjustment that would take stock below 0 → 400 `INSUFFICIENT_STOCK`, nothing saved.
   - An audit row is written. Branch isolation. Admin → 403.
2. **Green** — one transaction: `postMovements` + `logAudit`.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(stock): add stock adjustments with reasons`

**As built (2026-10-30):**
- **Files:** as listed, plus `shared/src/schemas/adjustments.test.ts`, the exports in `shared/src/index.ts`, and the mount in `backend/src/routes.ts` (`/stock/adjustments`, before `/stock`). No model file: the only write is `postMovements`.
- **Contract:** `POST /api/v1/stock/adjustments` with `{ itemId, quantity, reason, note? }`, strict. The quantity is a signed whole number of packs, not 0, at most 1,000,000 either way (proposed, the same cap as a purchase line). The reason is `damage`, `expiry`, `theft`, `count_correction` or `other`. The note is trimmed, at most 200 characters, blank means none, and is required for `other` (422 on `body.note`). Answers 201 with `{ itemId, quantity, reason, note, balanceBefore, balanceAfter }`.
- **Rules:** `stock:adjust` (cashiers; the Admin gets 403) and a chosen branch. One transaction: one `adjustment` movement (`ref_type` `adjustment`, `ref_id` empty because there is no separate adjustment document, reason and note on the row), then the audit row `stock.adjust` on the item with the stock before and after, the change, the reason and the note. Below zero → 400 `INSUFFICIENT_STOCK` with the usual details, nothing saved and no audit. Another branch's item → 404.
- **Tests:** 9 schema tests and 14 route tests, including 5 parallel −3 adjustments on 10 packs (exactly 3 saved, 1 left, ledger matches). **Not run** (option 3).

---

## Task 6.2 — Day sales summary

**Goal:** the day-end report used to reconcile the cash drawer.

**Files:** `backend/src/modules/reports/day-summary.service.ts`, `day-summary.service.test.ts`

**Steps:**
1. **Red** — build a fixture with:
   - 2 cashiers, 2 branches
   - one bill paid cash + UPI + card
   - one cancelled bill
   - one bill at 23:30 IST (same day) and one at 00:10 IST (next day)

   `daySummary({ date, branchId?, cashierId? })` returns, per cashier and per branch:
   - bill count, subtotal, discount, round-off, total
   - totals per payment mode
   - cancelled bill count and value, **excluded** from all totals

   Check every number by hand in the test.
2. **Green** — implement with SQL aggregates.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(reports): add day sales summary`

**As built (2026-10-30):**
- **Files:** as listed, plus `day-summary.model.ts`, which holds the two SQL aggregates, per the AGENTS rule that queries live in a model.
- **`daySummary(db, { date, branchId?, cashierId? })`** returns `{ date, totals, branches: [{ branch, totals, cashiers: [{ cashier, totals }] }] }`. Branches are sorted by code and cashiers by name. Only branches and cashiers with bills that day appear.
- **Each `totals`:** completed bill count, subtotal, discount, signed round-off, net total, and payments by mode (cash / UPI / card, always all three). Cancelled bills are counted separately (count and value) and left out of everything else.
- **How it works:** bills count on their stored IST `bill_date`. A bill cancelled later still belongs to the day it was made. Two `GROUP BY` queries (bills by branch and cashier with `FILTER` on status; completed bills' payments by mode) are combined in the service.
- **Types** stay in the service until Task 6.6 adds the route and moves them into `shared`.
- **Tests:** 10, on a fixture of 5 bills across 2 branches and 2 cashiers. It includes a 3-mode bill, a cancelled one, 23:30 IST and 00:10 IST the next day, and round-offs of +0.25 and −0.25, all worked out by hand. **Not run** (option 3).

---

## Task 6.3 — Item-wise sales

**Goal:** quantity and value sold per item over a date range.

**Files:** `backend/src/modules/reports/item-sales.service.ts`, `item-sales.service.test.ts`

**Steps:**
1. **Red** — tests:
   - Sums quantity and `line_total_paise` per item for the range (inclusive IST dates). Cancelled bills are excluded.
   - Sorted by value, descending; paginated.
   - The report includes a note that bill-level round-off isn't in item totals, so the grand total can differ from the day summary by the round-off. Test that the difference equals the summed round-off.
2. **Green** — implement.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(reports): add item-wise sales report`

**As built (2026-10-30):**
- **Files:** as listed, plus `item-sales.model.ts` for the SQL.
- **`itemSales(db, { from, to, branchId?, limit, offset })`** returns a `Page` of `{ item: { id, code, name }, branch: { id, code }, quantity, valuePaise }`. It covers completed bills whose IST `bill_date` is in the range, both ends included. The value is the sum of line totals after line discounts. Rows are sorted by value (highest first), then name, then id, so pages are stable. The item's current code and name are shown; the bill lines keep the names as sold.
- **Range totals** cover every page: `itemsValuePaise`, the bills' summed `roundOffPaise`, and `billsTotalPaise`. The `note` explains that items add up to the bills total less the round-off.
- **Tests:** 6, on a hand-worked fixture of 6 bills: 2 branches, a cancelled bill, 23:30 and 00:10 IST, and round-offs of ±0.25. One test checks that the day summaries' total less the items' value equals the summed round-off, both over a range where it nets to 0 and over one where it is +0.25. **Not run** (option 3).

---

## Task 6.4 — Stock and low-stock reports

**Goal:** current stock per item, and the items that need reordering.

**Files:** `backend/src/modules/reports/stock-report.service.ts`, `stock-report.service.test.ts`

**Steps:**
1. **Red** — tests:
   - The stock report lists active items with quantity, category and selling price, filterable by category.
   - Low stock = items with a reorder level set **and** quantity ≤ reorder level. Items without a reorder level never appear.
2. **Green** — implement.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(reports): add stock and low-stock reports`

**As built (2026-10-30):**
- **Files:** as listed, plus `stock-report.model.ts` for the SQL, and `categoryId` and `reorderLevel` options on the `createItem` test fixture.
- **`stockReport` and `lowStockReport`** both take `{ branchId, categoryId?, limit, offset }` and return a `Page` of `{ item: { id, code, name }, category: { id, name } | null, quantity, sellingPricePaise, reorderLevel }`.
  - Both cover only the branch's active items.
  - The stock report is sorted by name.
  - The low-stock report lists items with a reorder level and stock at or below it, emptiest first, then by name. An item without a reorder level never appears, even at 0.
- **Movement history** per item is already served by `GET /stock/:itemId/movements` (Task 3.6), so the report does not repeat it.
- **Tests:** 8. **Not run** (option 3).

---

## Task 6.5 — Purchase register

**Goal:** posted purchases by vendor and date range.

**Files:** `backend/src/modules/reports/purchase-register.service.ts`, `purchase-register.service.test.ts`

**Steps:**
1. **Red** — tests:
   - Posted purchases whose `invoice_date` is in the range: vendor, invoice number, date, total.
   - A subtotal per vendor.
   - Cancelled purchases are listed separately and excluded. Drafts never appear.
2. **Green** — implement.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(reports): add purchase register`

**As built (2026-10-30):**
- **Files:** as listed, plus `purchase-register.model.ts` for the SQL.
- **`purchaseRegister(db, { from, to, branchId? })`** returns `{ from, to, vendors, totalPaise, cancelled }`.
  - **`vendors`:** one group per vendor, sorted by vendor name then branch code. Two branches' vendors with the same name stay separate. Each group has `{ vendor, branch, purchases, subtotalPaise }`, and each purchase has `{ id, vendorInvoiceNo, invoiceDate, totalPaise }`, by invoice date.
  - **`cancelled`:** cancelled purchases in the range, with vendor, branch and reason, kept out of every total.
- **Range:** by `invoice_date`, both ends included. Drafts never appear. The result is not paged, since a date range of purchases is small (proposed).
- **Tests:** 6 on a hand-worked fixture: 8 purchases with 3 vendors across 2 branches, a cancelled purchase, a draft, and dates on and outside both ends. **Not run** (option 3).

---

## Task 6.6 — Report routes and visibility

**Goal:** each role sees exactly what D-22 allows.

**Read first:** overview §6.10 (the visibility columns), §8 (report endpoints).

**Files:** `shared/src/schemas/reports.ts`, `backend/src/modules/reports/reports.{routes,controller}.ts`, `reports.routes.test.ts`

**Steps:**
1. **Red** — tests:
   - **Cashier, day summary:** `GET /reports/day-summary?date=` returns **only their own** figures in the active branch. A `cashierId` or `branchId` in the query is ignored or rejected.
   - **Cashier, stock:** `GET /reports/stock` and `/reports/low-stock` cover the active branch only.
   - **Cashier, other reports:** item-wise sales and the purchase register → 403.
   - **Admin:** `GET /admin/reports/:report?branchId=&from=&to=` covers all four reports; with no `branchId`, the result covers all branches.
   - Bad dates or a range over 366 days → 422.
2. **Green** — implement.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(reports): add report routes with role visibility`

---

## Task 6.7 — Frontend: stock adjustment

**Goal:** the adjustment screen.

**Files:** `frontend/src/pages/stock/AdjustmentPage.tsx`, `en.ts`

**Steps:**
1. Use `ItemPicker` to choose the item and show its current stock.
2. A + or − toggle with a quantity; a reason select; the note field appears and is required when the reason is "other".
3. A confirmation showing "stock X → Y". After saving, link to the item's movement history.

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check: one adjustment of each reason, plus one that would go below zero

**Commit:** `feat(frontend): add stock adjustment screen`

---

## Task 6.8 — Frontend: reports

**Goal:** report screens for cashiers (day-end) and the Admin (all reports).

**Files:** `frontend/src/pages/reports/*`, `frontend/src/print/report.css`, `en.ts`

**Steps:**
1. **Cashier — "My day-end" page:** pick a date (default today); the summary and payment-mode totals laid out for counting the drawer; print-friendly.
2. **Cashier — Stock and Low stock pages** for the active branch.
3. **Admin — Reports page:** choose the report, branch (or all), and date range; tables with totals rows; print-friendly A4 CSS.
4. Amounts are formatted with `formatPaise`.

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check on seeded data with a few bills: figures match the Bills screen

**Commit:** `feat(frontend): add report screens`

---

## Task 6.9 — i18n sweep

**Goal:** every UI label comes from the dictionary, so Tamil (FP-07) needs no screen changes.

**Read first:** D-25; `AGENTS.md` → UI text.

**Files:** `scripts/check-i18n.mjs`, root script `check:i18n`, any `.tsx` with hard-coded text, `en.ts`

**Steps:**
1. **(proposed)** `check-i18n.mjs` scans `frontend/src/**/*.tsx` for literal text between JSX tags, and for literal `placeholder`, `title` and `aria-label` values. It fails with file:line for each one. An allow-list covers symbols like `₹`, `/` and `×`.
2. Move every hit into `en.ts` and use `t()`.
3. Add `check:i18n` to the gate in `README.md`.

**Done when:**
- [ ] `npm run check:i18n` passes
- [ ] The rest of the gate passes

**Commit:** `refactor(frontend): move all ui text to the i18n dictionary`

---

## 🛑 Checkpoint 6

Agent: follow the checkpoint steps in `README.md`.

**Checkpoint review (user):**
- [ ] Make a few bills (one split, one cancelled), then open "My day-end" as each cashier and the Admin reports. Check the numbers by hand
- [ ] Do an adjustment and see it in the item's history
- [ ] Confirm the (proposed) items: report layouts, the i18n check
