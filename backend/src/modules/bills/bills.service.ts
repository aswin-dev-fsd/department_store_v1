// Bills (cashiers, per branch; D-13 to D-18): the counter's money and stock transaction. The
// browser sends ids, quantities, discounts, payments and an optional customer; every price and
// total is worked out here with the shared bill math, so the screen's preview and the stored bill
// agree. Every bill is audited (D-30).
import type { Db, DbOrTx } from '@ds/database';
import {
  businessDate,
  computeBill,
  financialYear,
  formatBillNo,
  type Bill,
  type ComputedBill,
  type CreateBillInput,
} from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import { findOrCreateByPhone } from '../customers/customers.service.js';
import { postMovements } from '../stock/stock.service.js';
import { allocateBillSeq } from './bill-number.service.js';
import * as model from './bills.model.js';
import type { BillDetailRow, BillLineRow, BillPaymentRow, SellableItem } from './bills.model.js';

function toBill(row: BillDetailRow, lines: BillLineRow[], payments: BillPaymentRow[]): Bill {
  return {
    id: row.id,
    billNo: row.billNo,
    fy: row.fy,
    seq: row.seq,
    billDate: row.billDate,
    status: row.status,
    cashier: { id: row.cashierId, fullName: row.cashierName },
    customer:
      row.customerId === null
        ? null
        : { id: row.customerId, phone: row.customerPhone ?? '', name: row.customerName },
    subtotalPaise: row.subtotalPaise,
    discountPaise: row.discountPaise,
    roundOffPaise: row.roundOffPaise,
    totalPaise: row.totalPaise,
    lines: lines.map((line) => ({
      lineNo: line.lineNo,
      itemId: line.itemId,
      itemName: line.itemName,
      itemCode: line.itemCode,
      mrpPaise: line.mrpPaise,
      unitPricePaise: line.unitPricePaise,
      quantity: line.quantity,
      discountPaise: line.discountPaise,
      lineTotalPaise: line.lineTotalPaise,
    })),
    payments: payments.map((payment) => ({ mode: payment.mode, amountPaise: payment.amountPaise })),
    cancelledBy:
      row.cancelledBy === null
        ? null
        : { id: row.cancelledBy, fullName: row.cancelledByName ?? '' },
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A bill of the branch with its lines and payments; another branch's is not found. */
export async function loadBill(db: DbOrTx, branchId: number, id: number): Promise<Bill> {
  const row = await model.findBill(db, branchId, id);
  if (!row) {
    throw new NotFoundError('Bill not found');
  }
  return toBill(row, await model.findLines(db, id), await model.findPayments(db, id));
}

/**
 * Every line's item, active and of this branch, with its current price. An item that is
 * inactive, of another branch or unknown answers 404, as the ledger does.
 */
async function requireItems(
  db: DbOrTx,
  branchId: number,
  input: CreateBillInput,
): Promise<Map<number, SellableItem>> {
  const ids = [...new Set(input.lines.map((line) => line.itemId))];
  const found = new Map(
    (await model.findSellableItems(db, branchId, ids)).map((item) => [item.id, item]),
  );
  if (ids.some((id) => !found.has(id))) {
    throw new NotFoundError('Item not found, or no longer sold');
  }
  return found;
}

/** The bill's amounts from the items' current prices; a discount above its line is a 422. */
function priceBill(input: CreateBillInput, items: Map<number, SellableItem>): ComputedBill {
  const lines = input.lines.map((line) => ({
    unitPricePaise: items.get(line.itemId)!.sellingPricePaise,
    quantity: line.quantity,
    discountPaise: line.discountPaise,
  }));
  const problems = lines.flatMap((line, index) =>
    line.discountPaise > line.quantity * line.unitPricePaise
      ? [
          {
            path: `body.lines.${index}.discountPaise`,
            message: 'The discount cannot be more than the line amount',
          },
        ]
      : [],
  );
  if (problems.length > 0) {
    throw new ValidationError('Invalid request data', problems);
  }
  try {
    return computeBill(lines);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ValidationError('Invalid request data', [
        { path: 'body.lines', message: 'This bill is too large' },
      ]);
    }
    throw error;
  }
}

/**
 * Save a complete bill in one transaction (overview §7.3; Task 5.5): load the items and their
 * prices, compute the totals, check the payments add up to the total exactly, find or create the
 * customer, take the next bill number, insert the bill, its lines and payments, then take the
 * stock out through the ledger. Any failure, a short item included (INSUFFICIENT_STOCK, from the
 * ledger), rolls all of it back, the bill number too, so the numbers stay gapless.
 *
 * `at` is the moment of the sale; it decides the financial year and the IST business date.
 */
export async function createBill(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  input: CreateBillInput,
  at: Date,
  ip: string | null,
): Promise<Bill> {
  return db.transaction(async (tx) => {
    const items = await requireItems(tx, branchId, input);
    const amounts = priceBill(input, items);

    const paidPaise = input.payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
    if (paidPaise !== amounts.totalPaise) {
      throw new AppError(
        'PAYMENT_MISMATCH',
        'The payments do not add up to the bill total',
        { totalPaise: amounts.totalPaise, paidPaise },
      );
    }

    const customer = input.customer
      ? await findOrCreateByPhone(tx, input.customer.phone, input.customer.name, {
          actorId: ctx.user.id,
          branchId,
          ip,
        })
      : null;

    const branchCode = await model.findBranchCode(tx, branchId);
    if (branchCode === undefined) {
      throw new NotFoundError('Branch not found');
    }
    const fy = financialYear(at);
    const seq = await allocateBillSeq(tx, branchId, fy);

    const bill = await model.insertBill(tx, {
      branchId,
      fy,
      seq,
      billNo: formatBillNo(branchCode, fy, seq),
      billDate: businessDate(at),
      cashierId: ctx.user.id,
      customerId: customer?.id ?? null,
      subtotalPaise: amounts.subtotalPaise,
      discountPaise: amounts.discountPaise,
      roundOffPaise: amounts.roundOffPaise,
      totalPaise: amounts.totalPaise,
      createdAt: at,
    });
    await model.insertLines(
      tx,
      input.lines.map((line, index) => {
        const item = items.get(line.itemId)!;
        const computed = amounts.lines[index]!;
        return {
          billId: bill.id,
          lineNo: index + 1,
          itemId: item.id,
          itemName: item.name,
          itemCode: item.code,
          mrpPaise: item.mrpPaise,
          unitPricePaise: computed.unitPricePaise,
          quantity: computed.quantity,
          discountPaise: computed.discountPaise,
          lineTotalPaise: computed.lineTotalPaise,
        };
      }),
    );
    await model.insertPayments(
      tx,
      input.payments.map((payment) => ({ billId: bill.id, ...payment })),
    );

    // Last, so the movements can name the bill; a short item throws and undoes everything above
    await postMovements(tx, {
      branchId,
      userId: ctx.user.id,
      movements: input.lines.map((line) => ({
        itemId: line.itemId,
        quantity: -line.quantity,
        type: 'sale',
        refType: 'bill',
        refId: bill.id,
      })),
    });

    await logAudit(tx, {
      actorId: ctx.user.id,
      branchId,
      action: 'bill.create',
      entity: 'bill',
      entityId: bill.id,
      after: {
        billNo: bill.billNo,
        totalPaise: bill.totalPaise,
        lineCount: input.lines.length,
        payments: input.payments,
        customerId: bill.customerId,
      },
      ip,
    });
    return loadBill(tx, branchId, bill.id);
  });
}
