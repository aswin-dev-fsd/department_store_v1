import { rupeesToPaise, type Item, type Vendor } from '@ds/shared';
import type { FieldErrors } from '../forms/fieldErrors';
import { t } from '../i18n/t';

// Form state is always text, so every input stays controlled. The shared zod schemas turn it
// into API input on submit (trimming, blank optional values → null). The item form is the one
// exception: prices are typed in rupees, so they are converted to paise first.

export interface ItemFormValues {
  code: string;
  barcode: string;
  name: string;
  /** The category's id as text; empty means no category. */
  categoryId: string;
  /** Rupees as typed, like "145.50". */
  mrp: string;
  sellingPrice: string;
  /** Packs as typed; empty means no warning. */
  reorderLevel: string;
}

export const EMPTY_ITEM_FORM: ItemFormValues = {
  code: '',
  barcode: '',
  name: '',
  categoryId: '',
  mrp: '',
  sellingPrice: '',
  reorderLevel: '',
};

/** Whole paise as the rupees text a person edits: 62000 → "620.00". */
export function paiseToInput(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** The edit form's starting values for an item. */
export function itemToForm(item: Item): ItemFormValues {
  return {
    code: item.code,
    barcode: item.barcode ?? '',
    name: item.name,
    categoryId: item.categoryId === null ? '' : String(item.categoryId),
    mrp: paiseToInput(item.mrpPaise),
    sellingPrice: paiseToInput(item.sellingPricePaise),
    reorderLevel: item.reorderLevel === null ? '' : String(item.reorderLevel),
  };
}

/** A price typed in rupees, as whole paise; null when the text is not an amount. */
export function parseRupees(text: string): number | null {
  try {
    return rupeesToPaise(text);
  } catch {
    return null;
  }
}

/** Packs typed as digits: null when blank, NaN for anything else (which no schema accepts). */
function parsePacks(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

function priceProblem(text: string): string {
  return text.trim() === '' ? t('items.priceRequired') : t('items.priceFormat');
}

export interface ConvertedItemForm {
  /** What the shared item schemas take: prices in paise, blanks left for them to turn into null. */
  input: Record<string, unknown>;
  /** Cells that could not be converted, by form field; they replace the schemas' wording. */
  problems: FieldErrors;
}

/**
 * Turn the item form's text into the API's input. A price or reorder level that is not a number
 * becomes NaN (so the schema refuses it) and a plain message for that field.
 */
export function convertItemForm(values: ItemFormValues): ConvertedItemForm {
  const problems: FieldErrors = {};
  const mrpPaise = parseRupees(values.mrp);
  const sellingPricePaise = parseRupees(values.sellingPrice);
  const reorderLevel = parsePacks(values.reorderLevel);
  if (mrpPaise === null) problems.mrp = priceProblem(values.mrp);
  if (sellingPricePaise === null) problems.sellingPrice = priceProblem(values.sellingPrice);
  if (Number.isNaN(reorderLevel)) problems.reorderLevel = t('items.reorderFormat');

  return {
    input: {
      code: values.code,
      barcode: values.barcode,
      name: values.name,
      categoryId: values.categoryId === '' ? null : Number(values.categoryId),
      mrpPaise: mrpPaise ?? Number.NaN,
      sellingPricePaise: sellingPricePaise ?? Number.NaN,
      reorderLevel,
    },
    problems,
  };
}

// The API names the prices in paise; the form names them in rupees
const FORM_FIELD: Readonly<Record<string, string>> = {
  mrpPaise: 'mrp',
  sellingPricePaise: 'sellingPrice',
};

/** Put errors keyed by the API's field names under the form's field names. */
export function toFormFields(errors: FieldErrors): FieldErrors {
  return Object.fromEntries(
    Object.entries(errors).map(([field, message]) => [FORM_FIELD[field] ?? field, message]),
  );
}

export interface VendorFormValues {
  name: string;
  phone: string;
  address: string;
  gstin: string;
}

export const EMPTY_VENDOR_FORM: VendorFormValues = { name: '', phone: '', address: '', gstin: '' };

/** The edit form's starting values for a vendor. */
export function vendorToForm(vendor: Vendor): VendorFormValues {
  return {
    name: vendor.name,
    phone: vendor.phone ?? '',
    address: vendor.address ?? '',
    gstin: vendor.gstin ?? '',
  };
}
