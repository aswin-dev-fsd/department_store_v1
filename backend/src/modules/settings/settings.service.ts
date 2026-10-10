// The client's business details (Admin): read and replace. Every change is audited (D-30).
import type { Db } from '@ds/database';
import type { ClientSettings, UpdateSettingsInput } from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import { changedFields } from '../../lib/changes.js';
import { NotFoundError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import * as model from './settings.model.js';
import type { SettingsRow, SettingsValues } from './settings.model.js';

function notSetUp(): NotFoundError {
  return new NotFoundError(
    'Client settings are not set up yet: run npm run setup:client first',
    'NOT_SET_UP',
  );
}

function toSettings(row: SettingsRow): ClientSettings {
  return {
    businessName: row.businessName,
    address: row.address,
    phone: row.phone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The editable fields: what change detection and audit rows look at. */
function editable(row: SettingsRow): SettingsValues {
  return { businessName: row.businessName, address: row.address, phone: row.phone };
}

/** The client settings, or NOT_SET_UP if setup:client has never run on this database. */
export async function getSettings(db: Db): Promise<ClientSettings> {
  const row = await model.findClientSettings(db);
  if (!row) {
    throw notSetUp();
  }
  return toSettings(row);
}

/**
 * Replace the client settings: a business name is required, and an omitted address or phone is
 * cleared. A request that changes nothing writes nothing, and no audit row.
 */
export async function updateSettings(
  db: Db,
  ctx: RequestContext,
  input: UpdateSettingsInput,
  ip: string | null,
): Promise<ClientSettings> {
  return db.transaction(async (tx) => {
    const current = await model.findClientSettingsForUpdate(tx);
    if (!current) {
      throw notSetUp();
    }
    const next: SettingsValues = {
      businessName: input.businessName,
      address: input.address ?? null,
      phone: input.phone ?? null,
    };
    const changes = changedFields(editable(current), next);
    if (!changes) {
      return toSettings(current);
    }
    const updated = await model.updateClientSettings(tx, changes.after);
    await logAudit(tx, {
      actorId: ctx.user.id,
      action: 'client_settings.update',
      entity: 'client_settings',
      entityId: 1,
      before: changes.before,
      after: changes.after,
      ip,
    });
    return toSettings(updated);
  });
}
