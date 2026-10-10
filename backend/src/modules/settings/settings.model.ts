// Database queries for the client's settings — no business rules here (DreamLand §4).
// Grows with Task 2.8.
import { schema, type DbOrTx } from '@ds/database';

const { clientSettings } = schema;

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
