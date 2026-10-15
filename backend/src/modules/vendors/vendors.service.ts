// Vendors (cashiers, per branch): list, create, edit and deactivate. Every change is audited (D-30).
import type { Db } from '@ds/database';
import type {
  CreateVendorInput,
  ListVendorsQuery,
  Page,
  UpdateVendorInput,
  Vendor,
} from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import { changedFields } from '../../lib/changes.js';
import { NotFoundError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import * as model from './vendors.model.js';
import type { VendorChanges, VendorRow } from './vendors.model.js';

function toVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    gstin: row.gstin,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The fields an edit may change: what the audit rows record. */
function editable(row: VendorRow): Required<VendorChanges> {
  return {
    name: row.name,
    phone: row.phone,
    address: row.address,
    gstin: row.gstin,
    isActive: row.isActive,
  };
}

/** One page of the branch's vendors by name; active and inactive alike unless filtered. */
export async function listVendors(
  db: Db,
  branchId: number,
  query: ListVendorsQuery,
): Promise<Page<Vendor>> {
  const { rows, total } = await model.listVendors(db, branchId, query);
  return { items: rows.map(toVendor), total, limit: query.limit, offset: query.offset };
}

/** Create a vendor in the branch. Names are not unique: two vendors may share one. */
export async function createVendor(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  input: CreateVendorInput,
  ip: string | null,
): Promise<Vendor> {
  return db.transaction(async (tx) => {
    const row = await model.insertVendor(tx, {
      branchId,
      name: input.name,
      phone: input.phone ?? null,
      address: input.address ?? null,
      gstin: input.gstin ?? null,
    });
    await logAudit(tx, {
      actorId: ctx.user.id,
      branchId,
      action: 'vendor.create',
      entity: 'vendor',
      entityId: row.id,
      after: editable(row),
      ip,
    });
    return toVendor(row);
  });
}

/**
 * Edit a vendor of the branch, or deactivate / reactivate it with `isActive`. Only fields that
 * really change are written and audited (with the old and new values); a request that changes
 * nothing writes nothing. A vendor of another branch is not found.
 */
export async function updateVendor(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  id: number,
  patch: UpdateVendorInput,
  ip: string | null,
): Promise<Vendor> {
  return db.transaction(async (tx) => {
    const current = await model.findVendorForUpdate(tx, branchId, id);
    if (!current) {
      throw new NotFoundError('Vendor not found');
    }
    const changes = changedFields(editable(current), patch);
    if (!changes) {
      return toVendor(current);
    }
    const updated = await model.updateVendor(tx, id, changes.after);
    await logAudit(tx, {
      actorId: ctx.user.id,
      branchId,
      action:
        changes.after.isActive === undefined
          ? 'vendor.update'
          : changes.after.isActive
            ? 'vendor.activate'
            : 'vendor.deactivate',
      entity: 'vendor',
      entityId: id,
      before: changes.before,
      after: changes.after,
      ip,
    });
    return toVendor(updated);
  });
}
