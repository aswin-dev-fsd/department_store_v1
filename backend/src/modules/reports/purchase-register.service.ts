// The purchase register (D-22; overview §6.10): posted purchases whose vendor invoice date is in
// a range, grouped by vendor with a subtotal each. Cancelled purchases are listed apart and kept
// out of every total; drafts never appear.
import type { Db } from '@ds/database';
import * as model from './purchase-register.model.js';

export interface RegisterPurchase {
  id: number;
  vendorInvoiceNo: string;
  /** YYYY-MM-DD. */
  invoiceDate: string;
  totalPaise: number;
}

export interface RegisterVendor {
  vendor: { id: number; name: string };
  branch: { id: number; code: string };
  /** By invoice date, then invoice number. */
  purchases: RegisterPurchase[];
  subtotalPaise: number;
}

export interface CancelledPurchase extends RegisterPurchase {
  vendor: { id: number; name: string };
  branch: { id: number; code: string };
  cancelReason: string | null;
}

export interface PurchaseRegister {
  from: string;
  to: string;
  /** By vendor name; posted purchases only. */
  vendors: RegisterVendor[];
  /** All posted purchases in the range. */
  totalPaise: number;
  /** Cancelled purchases in the range, in no total. */
  cancelled: CancelledPurchase[];
}

export interface PurchaseRegisterQuery {
  from: string;
  to: string;
  branchId?: number | undefined;
}

/** The register for an invoice-date range (both ends included), optionally for one branch. */
export async function purchaseRegister(
  db: Db,
  query: PurchaseRegisterQuery,
): Promise<PurchaseRegister> {
  const rows = await model.findRegisterRows(db, query);

  const vendors: RegisterVendor[] = [];
  const cancelled: CancelledPurchase[] = [];
  let totalPaise = 0;
  for (const row of rows) {
    const purchase: RegisterPurchase = {
      id: row.id,
      vendorInvoiceNo: row.vendorInvoiceNo,
      invoiceDate: row.invoiceDate,
      totalPaise: row.totalPaise,
    };
    const vendor = { id: row.vendorId, name: row.vendorName };
    const branch = { id: row.branchId, code: row.branchCode };
    if (row.status === 'cancelled') {
      cancelled.push({ ...purchase, vendor, branch, cancelReason: row.cancelReason });
      continue;
    }
    let group = vendors.at(-1);
    if (group?.vendor.id !== row.vendorId) {
      group = { vendor, branch, purchases: [], subtotalPaise: 0 };
      vendors.push(group);
    }
    group.purchases.push(purchase);
    group.subtotalPaise += row.totalPaise;
    totalPaise += row.totalPaise;
  }

  return { from: query.from, to: query.to, vendors, totalPaise, cancelled };
}
