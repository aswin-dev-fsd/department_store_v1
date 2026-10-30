import type { CreateAdjustmentInput } from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { activeBranchId } from '../../lib/branch-scope.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './adjustments.service.js';

/** Request handlers for /stock/adjustments — req/res only; the rules live in adjustments.service. */
export function adjustmentsController({ db }: AppDeps) {
  const create: RequestHandler = async (req, res) => {
    const adjustment = await service.createAdjustment(
      db,
      requestContext(req),
      activeBranchId(req),
      req.body as CreateAdjustmentInput,
      req.ip ?? null,
    );
    res.status(201).json(success(adjustment));
  };

  return { create };
}
