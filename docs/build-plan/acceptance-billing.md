# Counter acceptance test — billing (Task 5.11)

A real run at a counter PC with a barcode scanner and, if there is one, an 80mm thermal printer. The user runs it and writes **Pass** or **Fail** (with a note) in the **Result** column; the agent fixes each failure as its own small commit and the line is run again.

**Run on:** ____________ **By:** ____________ **Printer:** ____________ **Scanner:** ____________

## Before you start

| # | Do | Expect | Result |
|---|---|---|---|
| 0.1 | Start the API and the web app: `npm run dev:backend` and `npm run dev:frontend` in two terminals ([dev-setup.md §6](../dev-setup.md#6-run-the-app)) | Both start without errors | |
| 0.2 | Open http://localhost:5173/status | **API: ok** and **Database: ok** | |
| 0.3 | Printer: set it up as in [dev-setup.md, "Print receipts at the counter"](../dev-setup.md#print-receipts-at-the-counter-80mm). No printer: use **Save as PDF** in the print dialog for every print step | The printer is the default, or Save as PDF is ready | |
| 0.4 | Note the seeded stock of the test items at Tiruppur (TPR) on the **Stock** screen, logged in as `cashier1`. Seeded values are shown below; bills made while trying the app earlier will have lowered some | Values written down: Basmati ______ Moong dal ______ Iodised salt ______ | |

The logins are the dev-seed ones in [dev-setup.md §6](../dev-setup.md#fill-a-dev-database-with-demo-data-optional) (fixed and public: dev only, D-32).

**Test items (TPR, as seeded):**

| Code | Barcode | Name | Price | Seeded stock |
|---|---|---|---|---|
| GRC001 | 8901000000019 | Basmati rice 5 kg | ₹499 | 50 |
| GRC002 | 8901000000026 | Sona masoori rice 10 kg | ₹599 | 57 |
| GRC003 | 8901000000033 | Toor dal 1 kg | ₹172 | 64 |
| GRC004 | 8901000000040 | Moong dal 1 kg | ₹149 | **3** |
| GRC005 | 8901000000057 | Sugar 1 kg | ₹48 | 78 |
| GRC006 | 8901000000064 | Iodised salt 1 kg | ₹26 | **0** |
| GRC007 | 8901000000071 | Wheat flour (atta) 5 kg | ₹249 | 92 |
| GRC008 | 8901000000088 | Sunflower oil 1 l | ₹152 | 99 |
| GRC009 | 8901000000095 | Groundnut oil 1 l | ₹215 | 56 |
| GRC010 | 8901000000101 | Tamarind 500 g | ₹82 | 63 |
| BEV001 | 8901000000118 | Tea powder 250 g | ₹120 | 70 |
| BEV002 | 8901000000125 | Instant coffee 100 g | ₹289 | 77 |
| BEV003 | 8901000000132 | Cola 2 l | ₹90 | 84 |
| BEV004 | 8901000000149 | Lemon soda 750 ml | ₹38 | 91 |

Scan the barcode off a printed label if you have one. Otherwise type the barcode and press Enter, which is what a USB scanner does.

## 1. Login

| # | Do | Expect | Result |
|---|---|---|---|
| 1.1 | Log in as `cashier1` | Lands on **Billing**; "Counter at TPR — …"; the cursor is in the scan box | |
| 1.2 | Log out, log in with a wrong password | "Wrong username or password."; no way in | |

## 2. Scanning 10 items, with a repeat scan

| # | Do | Expect | Result |
|---|---|---|---|
| 2.1 | Scan GRC001, GRC002, GRC003, GRC005, GRC007, GRC008, GRC009, GRC010, BEV001, BEV002 (10 barcodes from the table) | 10 lines, quantity 1 each, in scan order; the cursor is back in the scan box after every scan; "Lines: 10" | |
| 2.2 | Scan GRC001 again | No new line: Basmati becomes quantity **2**; total goes up by ₹499 | |
| 2.3 | Scan or type `1234567890123` + Enter | A short "no item matches" message; nothing added; the cursor stays in the box | |
| 2.4 | Check the totals panel | Subtotal = the sum of the line totals; the total is to the nearest rupee, with the round-off shown | |

## 3. Name search and code entry

| # | Do | Expect | Result |
|---|---|---|---|
| 3.1 | Type `cola` (do not press Enter) | After a moment a list shows **Cola 2 l** | |
| 3.2 | Press ↓ then Enter | Cola 2 l is added, quantity 1; the box empties | |
| 3.3 | Type `BEV004` + Enter | Lemon soda 750 ml is added (exact code, no list) | |
| 3.4 | Press **F2** from anywhere on the page | The cursor goes to the scan box | |

## 4. Line discount and editing

| # | Do | Expect | Result |
|---|---|---|---|
| 4.1 | On Basmati (quantity 2), type discount `20` | Line total ₹978.00 (2 × 499 − 20); the Discount total shows ₹20.00 | |
| 4.2 | Change the discount to `2000` | Red "The discount cannot be more than the line amount."; Save stays disabled | |
| 4.3 | Set it back to `20`; change Lemon soda's quantity to `0` | Red "Enter a whole number of packs"; Save disabled | |
| 4.4 | Press **Remove** on Lemon soda | The line goes; the cursor is back in the scan box; totals update | |

## 5. Split payment with cash change, save and print

| # | Do | Expect | Result |
|---|---|---|---|
| 5.1 | Press **F8** | The cursor is in **Cash (₹)** | |
| 5.2 | Enter UPI `500` and Card `200`; press **Rest in cash** | Cash fills with the rest; "Paid in full". Cash filled: ______ | |
| 5.3 | In **Cash handed over**, enter the next round amount above the cash (e.g. cash 1,543 → `1600`) | "Change due" shows the difference | |
| 5.4 | Type a mobile number new to the system (e.g. `98765 43210`, or one not used before) | "New customer: added when the bill is saved." and a name field; type a name | |
| 5.5 | Press **F9** | "Bill TPR/26-27/00000N saved. Give change: ₹…"; the receipt prints (or the print dialog opens); the screen empties and the cursor is back in the scan box. Bill no.: ______ | |

## 6. The receipt (from 5.5)

| # | Check | Expect | Result |
|---|---|---|---|
| 6.1 | Width | Fits 80mm paper, nothing cut off on the right | |
| 6.2 | Header | Business name, branch name, address and phone | |
| 6.3 | Bill details | Bill number, date and time (IST), cashier, customer name and phone | |
| 6.4 | Lines | Every item; long names wrap; Basmati shows 2 × ₹499.00, the ₹20 discount and its line total | |
| 6.5 | Totals | Subtotal, discount, round-off and total equal the screen's | |
| 6.6 | Payments | Cash, UPI and Card with the amounts entered (the cash part, **not** the cash handed over) | |
| 6.7 | Footer | The branch footer, if one is set in Administration → Branches | |

## 7. Insufficient stock

| # | Do | Expect | Result |
|---|---|---|---|
| 7.1 | Scan Iodised salt (GRC006, stock 0) | Added, with an amber "Only 0 in stock…" warning | |
| 7.2 | Pay **Rest in cash**, press **Save bill** | Refused: "Not enough stock for the lines marked below…", the line marked red "Available: 0"; nothing saved; the lines and payment stay | |
| 7.3 | Remove the salt line, add Sugar, pay, save | Saves as the **next** number after 5.5: no number was used up by 7.2. Bill no.: ______ | |

## 8. Reprint

| # | Do | Expect | Result |
|---|---|---|---|
| 8.1 | Open **Bills**; search the bill number from 5.5 (or part of it, e.g. the last digits) | That bill is listed, Completed, with the customer and total | |
| 8.2 | Search by the customer's mobile from 5.4 | The same bill is listed | |
| 8.3 | Open it; press **Reprint receipt** | The same receipt prints again | |

## 9. Cancel and re-bill

| # | Do | Expect | Result |
|---|---|---|---|
| 9.1 | On the bill from 5.5, press **Cancel this bill**; type `ab` | "Yes, cancel bill …" stays disabled (at least 3 characters); the panel shows the bill number and total | |
| 9.2 | Type the reason `Customer changed the order`; confirm | Status **Cancelled**; "Cancelled by … Reason: Customer changed the order" | |
| 9.3 | Reprint it | The receipt has a boxed **CANCELLED** with the reason | |
| 9.4 | **Stock**: Basmati | Back up by 2 (the 5.5 sale returned) | |
| 9.5 | **Billing**: bill Basmati × 1 again, cash, save | A new, next bill number; the cancelled bill keeps its own number. Bill no.: ______ | |
| 9.6 | **Bills**, status **Cancelled** | Only the cancelled bill(s) are listed | |

## 10. Two counters, the last unit, at the same moment

Moong dal (GRC004) starts at 3 (or what 0.4 showed).

| # | Do | Expect | Result |
|---|---|---|---|
| 10.1 | Counter A (`cashier1`): bill Moong dal until **1** is left (quantity = stock − 1), cash, save | Saves; Stock shows Moong dal **1** | |
| 10.2 | Open a second browser window that does not share cookies (another browser, or an incognito/InPrivate window); log in as `cashier2` and choose **TPR** | Counter B is on Billing at TPR | |
| 10.3 | On both counters: add Moong dal × 1, press **Rest in cash**. Then press **Save** on both as close together as you can (two people, or click one and press F9 on the other) | **Exactly one** saves with a bill number; the other is refused with "Available: 0" on the Moong dal line | |
| 10.4 | Repeat 10.3 once more | Both refused ("Available: 0") | |

## 11. Stock check afterwards

| # | Do | Expect | Result |
|---|---|---|---|
| 11.1 | **Stock**: Moong dal | **0**; never below 0 | |
| 11.2 | **Stock**: Iodised salt | Still **0** (7.2 changed nothing) | |
| 11.3 | **Stock**: Basmati → its history | Opening, then a sale of 2 (5.5), a sale-cancel of 2 (9.2) and a sale of 1 (9.5); the balance is 0.4's value − 1 | |
| 11.4 | **Stock**: Sugar | 0.4's value − 1 (the 5.5 sale was cancelled in 9.2; 7.3 sold 1) | |
| 11.5 | **Bills**, today | Every bill from this run; numbers consecutive with no gaps; cancelled ones marked | |

## Results

| Section | Pass / Fail | Notes and fix commits |
|---|---|---|
| 0 Before you start | | |
| 1 Login | | |
| 2 Scanning | | |
| 3 Name search | | |
| 4 Discount and editing | | |
| 5 Split payment, save, print | | |
| 6 Receipt | | |
| 7 Insufficient stock | | |
| 8 Reprint | | |
| 9 Cancel and re-bill | | |
| 10 Two counters | | |
| 11 Stock check | | |

**Real thermal printer:** used / not available (Task 5.9 left this for here).
