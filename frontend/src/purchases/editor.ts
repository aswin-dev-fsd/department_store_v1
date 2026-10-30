import { purchaseDraftSchema, type Item, type Purchase, type PurchaseDraftInput } from '@ds/shared';
import { ApiError } from '../api/client';
import { paiseToInput, parseRupees } from '../catalog/forms';
import type { FieldErrors } from '../forms/fieldErrors';
import { t } from '../i18n/t';

// The purchase editor's state is text, so every input stays controlled. Money is typed in rupees
// and converted to paise here; the shared draft schema (the server's own) then checks the result.
// Field names: the header's are 'vendorId', 'vendorInvoiceNo', 'invoiceDate', 'notes'; a line's
// are 'lines.<index>.<field>' with the fields below.

/** One line as the cashier edits it. */
export interface EditorLine {
  /** Stable across edits, for React lists; never sent. */
  key: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  /** Packs as typed. */
  quantity: string;
  /** Rupees as typed. */
  cost: string;
  /** Optional rupees; empty means "keep the item's price". */
  newMrp: string;
  newSellingPrice: string;
}

/** A line's editable fields, in the order Enter moves through them. */
export const LINE_FIELDS = ['quantity', 'cost', 'newMrp', 'newSellingPrice'] as const;
export type LineField = (typeof LINE_FIELDS)[number];

export interface EditorValues {
  /** The vendor's id as text; empty until one is chosen. */
  vendorId: string;
  vendorInvoiceNo: string;
  /** YYYY-MM-DD. */
  invoiceDate: string;
  notes: string;
  lines: EditorLine[];
}

let lineCounter = 0;
const nextKey = () => `line-${++lineCounter}`;

/** Today's date in India as YYYY-MM-DD (the business date, AGENTS.md → Time). */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A new, empty draft dated today. */
export function emptyEditor(today = todayInIndia()): EditorValues {
  return { vendorId: '', vendorInvoiceNo: '', invoiceDate: today, notes: '', lines: [] };
}

/** A new line for an item, waiting for its quantity and cost. */
export function lineFromItem(item: Pick<Item, 'id' | 'code' | 'name'>): EditorLine {
  return {
    key: nextKey(),
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    quantity: '',
    cost: '',
    newMrp: '',
    newSellingPrice: '',
  };
}

const optionalRupees = (paise: number | null) => (paise === null ? '' : paiseToInput(paise));

/** A saved purchase, ready to edit. */
export function purchaseToEditor(purchase: Purchase): EditorValues {
  return {
    vendorId: String(purchase.vendor.id),
    vendorInvoiceNo: purchase.vendorInvoiceNo,
    invoiceDate: purchase.invoiceDate,
    notes: purchase.notes ?? '',
    lines: purchase.lines.map((line) => ({
      key: nextKey(),
      itemId: line.itemId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      quantity: String(line.quantity),
      cost: paiseToInput(line.costPricePaise),
      newMrp: optionalRupees(line.newMrpPaise),
      newSellingPrice: optionalRupees(line.newSellingPricePaise),
    })),
  };
}

/** Packs typed as digits; NaN for anything else (blank included), which the schema refuses. */
function parsePacks(text: string): number {
  const trimmed = text.trim();
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** quantity × cost for a line, or null while either is not a valid number yet. */
export function lineTotalPaise(line: Pick<EditorLine, 'quantity' | 'cost'>): number | null {
  const quantity = parsePacks(line.quantity);
  const cost = parseRupees(line.cost);
  return Number.isNaN(quantity) || cost === null ? null : quantity * cost;
}

/** The running total: the sum of the lines that are complete, and how many are not yet. */
export function runningTotal(lines: readonly EditorLine[]): {
  totalPaise: number;
  incomplete: number;
} {
  let totalPaise = 0;
  let incomplete = 0;
  for (const line of lines) {
    const total = lineTotalPaise(line);
    if (total === null) incomplete++;
    else totalPaise += total;
  }
  return { totalPaise, incomplete };
}

// The API names fields in paise and by item; the editor names them as the cashier sees them
const FORM_FIELD: Readonly<Record<string, string>> = {
  costPricePaise: 'cost',
  newMrpPaise: 'newMrp',
  newSellingPricePaise: 'newSellingPrice',
  itemId: 'item',
};

/** 'lines.2.costPricePaise' → 'lines.2.cost'; header fields stay as they are. */
function toEditorField(path: readonly PropertyKey[]): string {
  const parts = path.map(String);
  const last = parts.length - 1;
  if (last >= 0) parts[last] = FORM_FIELD[parts[last]!] ?? parts[last]!;
  return parts.join('.');
}

function addError(errors: FieldErrors, field: string, message: string): void {
  if (field !== '' && !(field in errors)) errors[field] = message;
}

export type DraftResult =
  { ok: true; draft: PurchaseDraftInput } | { ok: false; errors: FieldErrors };

/**
 * Turn the editor's text into the API's draft, checked with the server's own schema. A price that
 * is not an amount gets a plain message on its field; every other problem keeps the schema's.
 */
export function convertEditor(values: EditorValues): DraftResult {
  const errors: FieldErrors = {};
  const money = (index: number, field: LineField, text: string, optional: boolean) => {
    if (optional && text.trim() === '') return null;
    const paise = parseRupees(text);
    if (paise === null) {
      addError(
        errors,
        `lines.${index}.${field}`,
        text.trim() === '' ? t('purchases.costRequired') : t('items.priceFormat'),
      );
      return Number.NaN;
    }
    return paise;
  };

  const input = {
    vendorId: values.vendorId === '' ? undefined : Number(values.vendorId),
    vendorInvoiceNo: values.vendorInvoiceNo,
    invoiceDate: values.invoiceDate,
    notes: values.notes,
    lines: values.lines.map((line, index) => ({
      itemId: line.itemId,
      quantity: parsePacks(line.quantity),
      costPricePaise: money(index, 'cost', line.cost, false),
      newMrpPaise: money(index, 'newMrp', line.newMrp, true),
      newSellingPricePaise: money(index, 'newSellingPrice', line.newSellingPrice, true),
    })),
  };
  values.lines.forEach((line, index) => {
    if (Number.isNaN(parsePacks(line.quantity))) {
      addError(errors, `lines.${index}.quantity`, t('purchases.quantityFormat'));
    }
  });

  const result = purchaseDraftSchema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) {
      addError(errors, toEditorField(issue.path), issue.message);
    }
  }
  if (!result.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, draft: result.data };
}

/**
 * Field messages from a server 422, under the editor's field names. Draft saves name fields
 * 'body.lines.0.itemId'; posting names them 'lines.0.newSellingPricePaise' (there is no body).
 */
export function serverEditorErrors(error: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return errors;
  for (const detail of error.details as unknown[]) {
    if (typeof detail !== 'object' || detail === null) continue;
    const { path, message } = detail as { path?: unknown; message?: unknown };
    if (typeof path !== 'string' || typeof message !== 'string') continue;
    const parts = path.split('.');
    if (parts[0] === 'body') parts.shift();
    addError(errors, toEditorField(parts), message);
  }
  return errors;
}

/** The items a failed cancel names as already sold (INSUFFICIENT_STOCK details), by name. */
export function shortItemNames(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'INSUFFICIENT_STOCK') return [];
  if (!Array.isArray(error.details)) return [];
  return (error.details as unknown[])
    .map((detail) =>
      typeof detail === 'object' && detail !== null ? (detail as { name?: unknown }).name : null,
    )
    .filter((name): name is string => typeof name === 'string');
}
