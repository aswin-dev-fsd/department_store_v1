import {
  computeBill,
  computeLine,
  type BillLineInput,
  type ComputedBill,
  type Item,
} from '@ds/shared';
import { useMemo, useReducer } from 'react';
import { parseRupees } from '../../catalog/forms';
import { t } from '../../i18n/t';

// The bill on the counter screen before it is saved: pure state logic (a reducer and a summary),
// so it is tested without React. The totals come from the shared bill math, the same functions
// the server uses, so the preview always matches the saved bill. The server still decides: it
// looks the prices up again and checks the stock when the bill is saved.

/** One line as the cashier edits it: quantity and discount stay text, so inputs stay controlled. */
export interface DraftLine {
  /** Stable across edits, for React lists; never sent. */
  key: string;
  itemId: number;
  code: string;
  name: string;
  mrpPaise: number;
  /** The item's selling price when it was added: a preview only. */
  unitPricePaise: number;
  /** Packs on the shelf when the item was added. */
  stock: number;
  /** Packs as typed. */
  quantity: string;
  /** Rupees as typed; empty means no discount. */
  discount: string;
}

export interface BillDraft {
  lines: DraftLine[];
}

export type BillDraftAction =
  | { type: 'add'; item: Pick<Item, 'id' | 'code' | 'name' | 'mrpPaise' | 'sellingPricePaise' | 'stock'> }
  | { type: 'setQuantity'; key: string; quantity: string }
  | { type: 'setDiscount'; key: string; discount: string }
  | { type: 'remove'; key: string }
  | { type: 'reset' };

export const EMPTY_DRAFT: BillDraft = { lines: [] };

let keyCounter = 0;
const nextKey = () => `bill-line-${++keyCounter}`;

/** Packs typed as digits; null for anything else (blank included). */
function parsePacks(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * The bill's next state. Adding an item already on the bill adds 1 to that line, as a second scan
 * of the same item does; a new item becomes a new line with quantity 1, at the bottom.
 */
export function billDraftReducer(state: BillDraft, action: BillDraftAction): BillDraft {
  switch (action.type) {
    case 'add': {
      const existing = state.lines.find((line) => line.itemId === action.item.id);
      if (existing) {
        const current = parsePacks(existing.quantity) ?? 0;
        return {
          lines: state.lines.map((line) =>
            line === existing ? { ...line, quantity: String(current + 1) } : line,
          ),
        };
      }
      const item = action.item;
      return {
        lines: [
          ...state.lines,
          {
            key: nextKey(),
            itemId: item.id,
            code: item.code,
            name: item.name,
            mrpPaise: item.mrpPaise,
            unitPricePaise: item.sellingPricePaise,
            stock: item.stock,
            quantity: '1',
            discount: '',
          },
        ],
      };
    }
    case 'setQuantity':
      return {
        lines: state.lines.map((line) =>
          line.key === action.key ? { ...line, quantity: action.quantity } : line,
        ),
      };
    case 'setDiscount':
      return {
        lines: state.lines.map((line) =>
          line.key === action.key ? { ...line, discount: action.discount } : line,
        ),
      };
    case 'remove':
      return { lines: state.lines.filter((line) => line.key !== action.key) };
    case 'reset':
      return EMPTY_DRAFT;
  }
}

/** One line of the preview: its numbers, or why it cannot be counted yet. */
export interface LineSummary {
  key: string;
  /** quantity × price − discount; null while the line has a problem. */
  lineTotalPaise: number | null;
  /** What is wrong with the quantity or discount, in plain words. */
  problem: string | null;
  /** The quantity asked for is more than the shelf had when the item was added. */
  overStock: boolean;
}

export interface DraftSummary {
  lines: LineSummary[];
  /** The bill's totals over the lines that have no problem; null when there are none. */
  totals: ComputedBill | null;
  /** True when every line is valid and there is at least one: the bill can go to payment. */
  ready: boolean;
  /** What the server would be sent for the lines (only meaningful when `ready`). */
  input: BillLineInput[];
}

/** The preview of a draft: each line's total or problem, the bill totals, and the stock warnings. */
export function summarizeDraft(draft: BillDraft): DraftSummary {
  const valid: { unitPricePaise: number; quantity: number; discountPaise: number }[] = [];
  const input: BillLineInput[] = [];
  const lines = draft.lines.map((line): LineSummary => {
    const quantity = parsePacks(line.quantity);
    const discountPaise = line.discount.trim() === '' ? 0 : parseRupees(line.discount);
    const overStock = quantity !== null && quantity > line.stock;
    if (quantity === null || quantity < 1) {
      return { key: line.key, lineTotalPaise: null, problem: t('billing.quantityFormat'), overStock };
    }
    if (discountPaise === null) {
      return { key: line.key, lineTotalPaise: null, problem: t('billing.discountFormat'), overStock };
    }
    try {
      const computed = computeLine({ unitPricePaise: line.unitPricePaise, quantity, discountPaise });
      valid.push(computed);
      input.push({ itemId: line.itemId, quantity, discountPaise });
      return { key: line.key, lineTotalPaise: computed.lineTotalPaise, problem: null, overStock };
    } catch {
      return { key: line.key, lineTotalPaise: null, problem: t('billing.discountTooLarge'), overStock };
    }
  });

  let totals: ComputedBill | null = null;
  if (valid.length > 0) {
    try {
      totals = computeBill(valid);
    } catch {
      totals = null;
    }
  }
  return {
    lines,
    totals,
    ready: draft.lines.length > 0 && lines.every((line) => line.problem === null) && totals !== null,
    input,
  };
}

/** The counter's bill draft: state, its preview, and the actions the screen uses. */
export function useBillDraft() {
  const [draft, dispatch] = useReducer(billDraftReducer, EMPTY_DRAFT);
  const summary = useMemo(() => summarizeDraft(draft), [draft]);
  return {
    draft,
    summary,
    add: (item: Extract<BillDraftAction, { type: 'add' }>['item']) => dispatch({ type: 'add', item }),
    setQuantity: (key: string, quantity: string) => dispatch({ type: 'setQuantity', key, quantity }),
    setDiscount: (key: string, discount: string) => dispatch({ type: 'setDiscount', key, discount }),
    remove: (key: string) => dispatch({ type: 'remove', key }),
    reset: () => dispatch({ type: 'reset' }),
  };
}
