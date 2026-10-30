// Customers (Phase 5): optional on a bill (D-18). Client-wide, not per branch (D-08): the same
// phone number is the same person at every branch. Rules: overview §5.2 "customers".
import { pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns.js';

/** Someone who gave their phone number at the counter. Entering a known phone reuses the record. */
export const customers = pgTable('customers', {
  id: id(),
  // 10 digits, normalised by the server before it is stored (Task 5.4); one record per phone
  phone: text('phone').notNull().unique('customers_phone_key'),
  name: text('name'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
