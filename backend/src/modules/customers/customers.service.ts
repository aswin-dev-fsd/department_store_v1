// Customers (D-18): looked up by phone at the counter, and found or created when a bill names
// one. Client-wide (D-08): a cashier of any branch finds the same customer. Every write is
// audited (D-30).
import type { Db, DbOrTx } from '@ds/database';
import { normalisePhone, PHONE_MESSAGE, type Customer } from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import * as model from './customers.model.js';
import type { CustomerRow } from './customers.model.js';

function toCustomer(row: CustomerRow): Customer {
  return { id: row.id, phone: row.phone, name: row.name };
}

/** Who caused a write, for its audit row. */
export interface CustomerWriteBy {
  actorId: number;
  /** The branch the bill is made in; customers themselves belong to no branch. */
  branchId: number | null;
  ip: string | null;
}

/** The phone as stored, or a 422 on `path` when it is not a 10-digit Indian mobile number. */
function requirePhone(phone: string, path: string): string {
  const normalised = normalisePhone(phone);
  if (normalised === null) {
    throw new ValidationError('Invalid request data', [{ path, message: PHONE_MESSAGE }]);
  }
  return normalised;
}

/** The customer with this phone (any common format); 404 when there is none. */
export async function lookupCustomer(db: Db, phone: string): Promise<Customer> {
  const row = await model.findByPhone(db, requirePhone(phone, 'query.phone'));
  if (!row) {
    throw new NotFoundError('No customer with this phone number');
  }
  return toCustomer(row);
}

/**
 * The customer with this phone, created if new, inside the caller's transaction (the bill's, Task
 * 5.5). A name is kept for a new customer, and fills in a missing name of a known one; a known
 * name is never overwritten. Two counters creating the same phone at once get the same customer.
 * Throws a 422 on `body.customer.phone` for a phone that is not a 10-digit Indian mobile number.
 */
export async function findOrCreateByPhone(
  tx: DbOrTx,
  phone: string,
  name: string | null | undefined,
  by: CustomerWriteBy,
): Promise<Customer> {
  const stored = requirePhone(phone, 'body.customer.phone');
  const cleanName = name?.trim() ? name.trim() : null;

  const created = await model.insertIfAbsent(tx, stored, cleanName);
  if (created) {
    await logAudit(tx, {
      actorId: by.actorId,
      branchId: by.branchId,
      action: 'customer.create',
      entity: 'customer',
      entityId: created.id,
      after: { phone: created.phone, name: created.name },
      ip: by.ip,
    });
    return toCustomer(created);
  }

  // Known already (or created by another counter a moment ago, which has committed)
  const existing = (await model.findByPhone(tx, stored))!;
  if (cleanName !== null && existing.name === null) {
    const named = await model.fillMissingName(tx, existing.id, cleanName);
    if (named) {
      await logAudit(tx, {
        actorId: by.actorId,
        branchId: by.branchId,
        action: 'customer.update',
        entity: 'customer',
        entityId: named.id,
        before: { name: null },
        after: { name: named.name },
        ip: by.ip,
      });
      return toCustomer(named);
    }
  }
  return toCustomer(existing);
}
