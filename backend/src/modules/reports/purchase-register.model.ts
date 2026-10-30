import { schema, type Db } from '@ds/database';
import { and, asc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';

// Database queries for the purchase register only; the rules live in purchase-register.service.

const { branches, purchases, vendors } = schema;

export interface RegisterFilter {
  /** Invoice dates, YYYY-MM-DD, both included. */
  from: string;
  to: string;
  branchId?: number | undefined;
}

/** Posted and cancelled purchases whose invoice date is in the range (drafts never). */
export async function findRegisterRows(db: Db, { from, to, branchId }: RegisterFilter) {
  const where: SQL[] = [
    inArray(purchases.status, ['posted', 'cancelled']),
    gte(purchases.invoiceDate, from),
    lte(purchases.invoiceDate, to),
  ];
  if (branchId !== undefined) where.push(eq(purchases.branchId, branchId));
  return db
    .select({
      id: purchases.id,
      status: purchases.status,
      vendorInvoiceNo: purchases.vendorInvoiceNo,
      invoiceDate: purchases.invoiceDate,
      totalPaise: purchases.totalPaise,
      cancelReason: purchases.cancelReason,
      vendorId: vendors.id,
      vendorName: vendors.name,
      branchId: branches.id,
      branchCode: branches.code,
    })
    .from(purchases)
    .innerJoin(vendors, eq(vendors.id, purchases.vendorId))
    .innerJoin(branches, eq(branches.id, purchases.branchId))
    .where(and(...where))
    .orderBy(
      asc(vendors.name),
      asc(branches.code),
      asc(vendors.id),
      asc(purchases.invoiceDate),
      asc(purchases.vendorInvoiceNo),
      asc(purchases.id),
    );
}
