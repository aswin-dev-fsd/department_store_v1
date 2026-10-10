# Future Plans

Features agreed for later phases. None of these are in v1. Before one starts, confirm its requirements and write an implementation plan for it.

Last updated: 2026-10-10

| ID | Feature | Status |
|---|---|---|
| FP-01 | Online booking for customers | Requirements to be confirmed |
| FP-02 | Sales returns and purchase returns | Requirements to be confirmed |
| FP-03 | Owner role and other roles | v1 is built ready for it (D-04) |
| FP-04 | Copy items and vendors between branches | Requirements to be confirmed |
| FP-05 | Stock-take screen | Requirements to be confirmed |
| FP-06 | Vendor dues and payments | Requirements to be confirmed |
| FP-07 | Tamil language | v1 is built ready for it (D-25) |

Decision IDs (D-xx) refer to [pending-decisions.md](pending-decisions.md).

## FP-01 — Online booking for customers

Customers place orders online instead of coming to the counter.

Open questions:
- Payment: online prepayment, cash on delivery, or both — to be clarified
- Delivery, store pickup, or both
- Customer login: accounts with passwords, or phone number + OTP
- When an online order reduces stock: at booking, at packing, or at delivery
- Order statuses, e.g. placed → confirmed → packed → delivered / cancelled

v1 groundwork: customers are already client-wide records keyed by phone (D-08, D-18).

## FP-02 — Returns

Sales returns (a customer brings items back) and purchase returns (items sent back to the vendor).

Open questions:
- Refund method for sales returns: cash, credit note, or exchange
- Time limit for accepting returns
- Who can approve a return

The stock ledger (D-02) handles returns as new movement types, so no redesign is needed.

## FP-03 — Owner and other roles

v1 ships with Cashier and a minimal Admin (D-04). The Owner role takes over:
- All reports across branches
- Bill cancellations and stock adjustments, which then become Owner-only

Decide any other roles' permissions when they're needed. Adding a role is a permission-map entry plus a seed row.

## FP-04 — Copy items and vendors between branches

Give a new branch a starting item/vendor/category list by copying from another branch. After the copy, each branch's lists are independent (D-08).

Open questions: copy prices too, or names and codes only; copy all or pick categories.

## FP-05 — Stock-take screen

Enter counted quantities for many items at once; the system records the differences as adjustments in the ledger.

Open questions: freeze billing during the count or not; full count versus one category at a time.

## FP-06 — Vendor dues and payments

Track what the store owes each vendor: paid/unpaid purchases, part-payments, due dates, and a running balance per vendor.

## FP-07 — Tamil language

Tamil labels for screens, and Tamil item names on printed bills. The label dictionary and UTF-8 storage are already in place (D-25).

Open questions: language switch per user or per branch; item names in both languages or one.
