// The stock ledger service (D-02): `postMovements` is the only function in the system that changes
// stock. It writes the ledger rows and the item_stock quantities in the caller's transaction, so a
// bill, purchase or adjustment and its stock change are saved together or not at all.
import { schema, type Tx } from '@ds/database';
import { AppError, NotFoundError } from '../../lib/errors.js';
import * as model from './stock.model.js';

export type MovementType = (typeof schema.movementType.enumValues)[number];
export type MovementRefType = (typeof schema.movementRefType.enumValues)[number];
export type AdjustmentReason = (typeof schema.adjustmentReason.enumValues)[number];

export interface MovementInput {
  itemId: number;
  /** Signed, in packs: + in, − out. A whole number, never zero. */
  quantity: number;
  type: MovementType;
  /** What `refId` points at. */
  refType: MovementRefType;
  /** The bill, purchase or adjustment behind the movement; none for an import. */
  refId?: number;
  reason?: AdjustmentReason;
  note?: string;
  /** Unused until batch and expiry are decided (PD-02). */
  batchNo?: string;
  /** YYYY-MM-DD; unused until PD-02. */
  expiryDate?: string;
}

export interface PostMovementsInput {
  /** The branch the movements happen in; every item must belong to it. */
  branchId: number;
  /** Who caused them. */
  userId: number;
  movements: MovementInput[];
}

export interface PostedMovement {
  itemId: number;
  /** The item's stock right after this movement. */
  balanceAfter: number;
}

/** One item that cannot cover what the call takes out. */
export interface StockShortage {
  itemId: number;
  name: string;
  /** Stock before the call. */
  available: number;
  /** What was needed at the lowest point of the call (for a sale, the total quantity asked for). */
  requested: number;
}

/**
 * Apply movements to stock, all or nothing. Never opens a transaction: the caller passes its own
 * (`tx`), so the stock change commits or rolls back with the document that caused it.
 *
 * - Locks the stock rows (ordered by item id) so concurrent callers queue instead of overwriting
 *   each other, and so two counters cannot sell the same last unit.
 * - Applies the movements in order. If any item would drop below zero at any point, throws
 *   `INSUFFICIENT_STOCK` listing every short item, **before anything is written**.
 * - An item of another branch, or one that does not exist, throws `NotFoundError`.
 * - Returns one entry per movement, in the same order, with the balance after it.
 */
export async function postMovements(
  tx: Tx,
  { branchId, userId, movements }: PostMovementsInput,
): Promise<PostedMovement[]> {
  if (movements.length === 0) return [];

  for (const movement of movements) {
    if (!Number.isInteger(movement.quantity) || movement.quantity === 0) {
      throw new AppError(
        'INVALID_MOVEMENT',
        'A stock movement must be a whole number of packs, other than zero',
      );
    }
  }

  const itemIds = [...new Set(movements.map((movement) => movement.itemId))].sort((a, b) => a - b);
  const locked = new Map(
    (await model.lockStockRows(tx, branchId, itemIds)).map((row) => [row.itemId, row]),
  );
  if (itemIds.some((itemId) => !locked.has(itemId))) {
    throw new NotFoundError('Item not found');
  }

  // Walk the movements in order, tracking each item's running balance and its lowest point
  const running = new Map(itemIds.map((itemId) => [itemId, locked.get(itemId)!.quantity]));
  const lowest = new Map(running);
  const rows: model.NewMovement[] = movements.map((movement) => {
    const balanceAfter = running.get(movement.itemId)! + movement.quantity;
    running.set(movement.itemId, balanceAfter);
    lowest.set(movement.itemId, Math.min(lowest.get(movement.itemId)!, balanceAfter));
    return {
      branchId,
      itemId: movement.itemId,
      type: movement.type,
      quantity: movement.quantity,
      balanceAfter,
      refType: movement.refType,
      refId: movement.refId ?? null,
      reason: movement.reason ?? null,
      note: movement.note ?? null,
      batchNo: movement.batchNo ?? null,
      expiryDate: movement.expiryDate ?? null,
      createdBy: userId,
    };
  });

  const short: StockShortage[] = itemIds
    .filter((itemId) => lowest.get(itemId)! < 0)
    .map((itemId) => {
      const { name, quantity: available } = locked.get(itemId)!;
      return { itemId, name, available, requested: available - lowest.get(itemId)! };
    });
  if (short.length > 0) {
    throw new AppError(
      'INSUFFICIENT_STOCK',
      `Not enough stock for: ${short.map((item) => item.name).join(', ')}`,
      short,
    );
  }

  await model.setStockQuantities(
    tx,
    [...running].map(([itemId, quantity]) => ({ itemId, quantity })),
  );
  await model.insertMovements(tx, rows);

  return rows.map((row) => ({ itemId: row.itemId, balanceAfter: row.balanceAfter }));
}
