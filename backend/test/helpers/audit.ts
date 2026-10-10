import { schema, type Db } from '@ds/database';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { expect } from 'vitest';

export type AuditRow = typeof schema.auditLogs.$inferSelect;

export interface AuditMatch {
  action: string;
  entity?: string;
  entityId?: string | number;
  actorId?: number | null;
}

/**
 * Assert that an audit row matching `match` exists (D-30) and return the newest one.
 * Use it in every test of a write route or service.
 */
export async function expectAudit(db: Db, match: AuditMatch): Promise<AuditRow> {
  const { auditLogs } = schema;
  const conditions: SQL[] = [eq(auditLogs.action, match.action)];
  if (match.entity !== undefined) conditions.push(eq(auditLogs.entity, match.entity));
  if (match.entityId !== undefined) {
    conditions.push(eq(auditLogs.entityId, String(match.entityId)));
  }
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.id));
  expect(rows.length, `audit rows for ${JSON.stringify(match)}`).toBeGreaterThan(0);
  const row = rows[0]!;
  if (match.actorId !== undefined) {
    expect(row.actorId).toBe(match.actorId);
  }
  return row;
}
