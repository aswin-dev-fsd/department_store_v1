// Who can use the system, and where (Phase 2). Rules: overview §3, §5.2; D-04, D-07, D-10.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, id, ref, timestamptz, updatedAt } from './columns.js';

export const userRole = pgEnum('user_role', ['admin', 'cashier']);

/** The client's business details: exactly one row per deployment (D-07). */
export const clientSettings = pgTable(
  'client_settings',
  {
    id: smallint('id').primaryKey().default(1),
    businessName: text('business_name').notNull(),
    address: text('address'),
    phone: text('phone'),
    // Unused until GST is decided (PD-01)
    gstin: text('gstin'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('client_settings_single_row', sql`${t.id} = 1`)],
);

/** A store branch. `code` appears in bill numbers (D-15), so it is short and fixed. */
export const branches = pgTable(
  'branches',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    phone: text('phone'),
    billFooter: text('bill_footer'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('branches_code_format', sql`${t.code} ~ '^[A-Z]{1,3}$'`)],
);

/** A person who logs in. Deactivated, never deleted, so history keeps their name. */
export const users = pgTable(
  'users',
  {
    id: id(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    role: userRole('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    // Set after a reset or for a new account: the user must choose a new password first
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: timestamptz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_username_lower_key').on(sql`lower(${t.username})`)],
);

/** Which branches a cashier may work in (D-10). Admins aren't mapped. */
export const userBranches = pgTable(
  'user_branches',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.branchId] }),
    index('user_branches_branch_id_idx').on(t.branchId),
  ],
);

/** A login session. Only the SHA-256 hash of the cookie token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeBranchId: ref('active_branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamptz('expires_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);
