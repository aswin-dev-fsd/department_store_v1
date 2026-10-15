// Stock read API contract (the stock ledger, D-02): current stock per item and one item's movement
// history. Used by the backend (validation) and the frontend (screens). Stock itself changes only
// through the ledger service, never through this API.
import { z } from 'zod';
import { wholeNumberText } from './common.js';
import { paginationSchema } from './pagination.js';

// The ledger's vocabularies. They must match the database enums (checked by a backend test).

/** Why stock moved. */
export const MOVEMENT_TYPES = [
  'opening',
  'purchase',
  'purchase_cancel',
  'sale',
  'sale_cancel',
  'adjustment',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** What kind of record a movement's `refId` points at. */
export const MOVEMENT_REF_TYPES = ['bill', 'purchase', 'adjustment', 'import'] as const;
export type MovementRefType = (typeof MOVEMENT_REF_TYPES)[number];

/** The reason given for a manual correction (D-20). */
export const ADJUSTMENT_REASONS = [
  'damage',
  'expiry',
  'theft',
  'count_correction',
  'other',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

const positiveId = () =>
  wholeNumberText('Must be a positive whole number').pipe(
    z.number().int().min(1, 'Must be a positive whole number'),
  );

/** `:itemId` in a URL: a positive whole number. */
export const itemIdParamSchema = z.object({ itemId: positiveId() });
export type ItemIdParams = z.infer<typeof itemIdParamSchema>;

/**
 * `branchId` is for the Admin, who works in no branch and names the one to read. A cashier reads
 * the branch they work in; naming their own is accepted, naming another is refused by the server.
 */
const branchIdQuery = positiveId().optional();

export const listStockQuerySchema = paginationSchema.extend({
  categoryId: positiveId().optional(),
  branchId: branchIdQuery,
});
export type ListStockQuery = z.infer<typeof listStockQuerySchema>;

export const listMovementsQuerySchema = paginationSchema.extend({ branchId: branchIdQuery });
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;

/** One item and how many packs of it the branch holds now. */
export interface StockLine {
  itemId: number;
  code: string;
  barcode: string | null;
  name: string;
  categoryId: number | null;
  quantity: number;
  /** Low-stock warnings use this, in packs; null means "no warning". */
  reorderLevel: number | null;
  isActive: boolean;
}

/** One row of an item's ledger. */
export interface StockMovement {
  id: number;
  type: MovementType;
  /** Signed, in packs: + in, − out. */
  quantity: number;
  /** The item's stock right after this movement. */
  balanceAfter: number;
  /** What `refId` points at (a bill, a purchase, an adjustment or an import). */
  refType: MovementRefType;
  /** The document behind the movement; null for an import. */
  refId: number | null;
  /** For an adjustment: why. */
  reason: AdjustmentReason | null;
  note: string | null;
  createdBy: { id: number; fullName: string };
  createdAt: string;
}
