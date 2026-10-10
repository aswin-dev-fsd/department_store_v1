// Append-only history of every change and login event (D-30). Written by logAudit (Task 2.6)
// inside the same transaction as the change it describes.
import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { branches, users } from './access.js';
import { createdAt, id, ref } from './columns.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    // Empty for events without a known user, e.g. a failed login
    actorId: ref('actor_id').references(() => users.id),
    branchId: ref('branch_id').references(() => branches.id),
    // Verb-style, e.g. 'item.update', 'bill.cancel', 'auth.login_failed'
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    // Redacted snapshots
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
    index('audit_logs_created_at_idx').on(t.createdAt),
    index('audit_logs_actor_id_idx').on(t.actorId),
  ],
);
