import { bigint, timestamp } from 'drizzle-orm/pg-core';

/** Primary key: 64-bit identity, read as a JS number (exact up to 2^53). */
export const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/** A foreign-key column referencing an `id()` primary key. */
export const ref = (name: string) => bigint(name, { mode: 'number' });

/** A timestamptz column (stored in UTC; business dates are computed in Asia/Kolkata). */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Set once, when the row is inserted. */
export const createdAt = () => timestamptz('created_at').notNull().defaultNow();

/** Refreshed by Drizzle on every update made through it. */
export const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
