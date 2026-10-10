// The audit log (D-30): every change and every login event, with who, when, where and
// before/after. Always pass the transaction of the change itself, so the change and its
// audit row are saved together or not at all.
import { schema, type DbOrTx } from '@ds/database';

/** Replaces the value of any secret-looking field. */
export const REDACTED = '[redacted]';

// Matches password, passwordHash, token, tokenHash, apiSecret, …
const SECRET_KEY = /password|token|secret|hash/i;

/**
 * Deep copy of `value` with secret-looking fields replaced and dates as ISO strings.
 * A field whose value is true/false is never replaced: a boolean can't leak a secret, and
 * hiding flags such as `mustChangePassword` would erase what a password change actually did.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        SECRET_KEY.test(key) && typeof inner !== 'boolean' ? REDACTED : redact(inner),
      ]),
    );
  }
  return value;
}

export interface AuditEvent {
  /** Who did it; null when unknown (e.g. a failed login). */
  actorId: number | null;
  branchId?: number | null;
  /** Verb-style: 'auth.login', 'item.update', 'bill.cancel', … */
  action: string;
  /** What kind of record: 'user', 'branch', 'bill', … */
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Record one audit event. Secrets in before/after are redacted. */
export async function logAudit(db: DbOrTx, event: AuditEvent): Promise<void> {
  await db.insert(schema.auditLogs).values({
    actorId: event.actorId,
    branchId: event.branchId ?? null,
    action: event.action,
    entity: event.entity,
    entityId:
      event.entityId === undefined || event.entityId === null ? null : String(event.entityId),
    before: event.before === undefined ? null : redact(event.before),
    after: event.after === undefined ? null : redact(event.after),
    ip: event.ip ?? null,
  });
}
