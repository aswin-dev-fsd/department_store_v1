import type { IdParams } from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './import.service.js';

/** Request handlers for the CSV import — req/res only; the rules live in import.service. */
export function importController({ db }: AppDeps) {
  const importItems: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    // express.text only reads a text/csv body; anything else (or no body) leaves req.body unset
    if (typeof req.body !== 'string') {
      throw new AppError(
        'CSV_REQUIRED',
        'Send the file as the request body with Content-Type: text/csv',
        undefined,
        415,
      );
    }
    const result = await service.importItems(db, requestContext(req), id, req.body, req.ip ?? null);
    res.status(201).json(success(result));
  };

  return { importItems };
}
