import type { StockLine } from '@ds/shared';

/** A change in stock with its sign spelt out: 10 → "+10", -3 → "-3". */
export function signedQuantity(quantity: number): string {
  return quantity > 0 ? `+${quantity}` : String(quantity);
}

/** Whether an item is at or below its reorder level. Without a reorder level it never is. */
export function isLowStock(line: Pick<StockLine, 'quantity' | 'reorderLevel'>): boolean {
  return line.reorderLevel !== null && line.quantity <= line.reorderLevel;
}
