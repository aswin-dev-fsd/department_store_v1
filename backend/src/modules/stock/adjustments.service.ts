// Stock adjustments (D-20; overview §6.8): a cashier corrects stock with a reason. There is no
// separate document: the ledger row (type and ref type `adjustment`) carries the reason and note,
// and the audit row records who changed the item's stock from what to what.
import type { Db } from '@ds/database';
import type { CreateAdjustmentInput, StockAdjustment } from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import type { RequestContext } from '../../middleware/auth.js';
import { postMovements } from './stock.service.js';

/**
 * Adjust one item's stock in the branch, in one transaction with its audit row. An item of another
 * branch is not found (404); taking stock below zero throws INSUFFICIENT_STOCK and saves nothing.
 */
export async function createAdjustment(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  input: CreateAdjustmentInput,
  ip: string | null,
): Promise<StockAdjustment> {
  const note = input.note ?? null;
  return db.transaction(async (tx) => {
    const [posted] = await postMovements(tx, {
      branchId,
      userId: ctx.user.id,
      movements: [
        {
          itemId: input.itemId,
          quantity: input.quantity,
          type: 'adjustment',
          refType: 'adjustment',
          reason: input.reason,
          ...(note !== null && { note }),
        },
      ],
    });
    const balanceAfter = posted!.balanceAfter;
    const balanceBefore = balanceAfter - input.quantity;
    await logAudit(tx, {
      actorId: ctx.user.id,
      branchId,
      action: 'stock.adjust',
      entity: 'item',
      entityId: input.itemId,
      before: { stock: balanceBefore },
      after: { stock: balanceAfter, change: input.quantity, reason: input.reason, note },
      ip,
    });
    return {
      itemId: input.itemId,
      quantity: input.quantity,
      reason: input.reason,
      note,
      balanceBefore,
      balanceAfter,
    };
  });
}
