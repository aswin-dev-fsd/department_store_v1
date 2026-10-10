// Database queries for the client's settings — no business rules here (DreamLand §4).
import { schema, type DbOrTx } from '@ds/database';
import { eq } from 'drizzle-orm';

const { clientSettings } = schema;

export type SettingsRow = typeof clientSettings.$inferSelect;

/** The editable fields (the GSTIN stays out until GST is decided, PD-01). */
export interface SettingsValues {
  businessName: string;
  address: string | null;
  phone: string | null;
}

/**
 * Create the single client_settings row (id 1). Returns false and changes nothing if it already
 * exists. Atomic: of two simultaneous callers exactly one gets true.
 */
export async function insertClientSettingsIfAbsent(
  db: DbOrTx,
  values: { businessName: string },
): Promise<boolean> {
  const inserted = await db
    .insert(clientSettings)
    .values({ id: 1, businessName: values.businessName })
    .onConflictDoNothing()
    .returning({ id: clientSettings.id });
  return inserted.length > 0;
}

/** The settings row, or undefined if setup:client has never run. */
export async function findClientSettings(db: DbOrTx): Promise<SettingsRow | undefined> {
  const [row] = await db.select().from(clientSettings).where(eq(clientSettings.id, 1)).limit(1);
  return row;
}

/** The settings row, locked until the transaction ends so edits can't interleave. */
export async function findClientSettingsForUpdate(db: DbOrTx): Promise<SettingsRow | undefined> {
  const [row] = await db
    .select()
    .from(clientSettings)
    .where(eq(clientSettings.id, 1))
    .limit(1)
    .for('update');
  return row;
}

/** Apply changes to the settings row and return it. */
export async function updateClientSettings(
  db: DbOrTx,
  changes: Partial<SettingsValues>,
): Promise<SettingsRow> {
  const [row] = await db
    .update(clientSettings)
    .set(changes)
    .where(eq(clientSettings.id, 1))
    .returning();
  if (!row) {
    throw new Error('The client settings row disappeared while it was being updated');
  }
  return row;
}
