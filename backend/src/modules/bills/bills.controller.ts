import type { CreateBillInput } from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { activeBranchId } from '../../lib/branch-scope.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './bills.service.js';

/** Request handlers for /bills — req/res only; the rules live in bills.service. */
export function billsController({ db }: AppDeps) {
  const create: RequestHandler = async (req, res) => {
    const bill = await service.createBill(
      db,
      requestContext(req),
      activeBranchId(req),
      req.body as CreateBillInput,
      new Date(),
      req.ip ?? null,
    );
    res.status(201).json(success(bill));
  };

  return { create };
}
