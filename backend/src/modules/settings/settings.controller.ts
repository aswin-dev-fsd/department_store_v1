import type { UpdateSettingsInput } from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './settings.service.js';

/** Request handlers for /admin/settings — req/res only; the rules live in settings.service. */
export function settingsController({ db }: AppDeps) {
  const get: RequestHandler = async (_req, res) => {
    res.json(success(await service.getSettings(db)));
  };

  const update: RequestHandler = async (req, res) => {
    const settings = await service.updateSettings(
      db,
      requestContext(req),
      req.body as UpdateSettingsInput,
      req.ip ?? null,
    );
    res.json(success(settings));
  };

  return { get, update };
}
