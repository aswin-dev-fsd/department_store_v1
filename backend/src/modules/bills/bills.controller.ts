import type { CancelBillInput, CreateBillInput, IdParams, ListBillsQuery } from '@ds/shared';
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

  const list: RequestHandler = async (req, res) => {
    res.json(
      success(
        await service.listBills(db, activeBranchId(req), req.query as unknown as ListBillsQuery),
      ),
    );
  };

  const get: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    res.json(success(await service.getBill(db, activeBranchId(req), id)));
  };

  const receipt: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    res.json(success(await service.getReceipt(db, activeBranchId(req), id)));
  };

  const cancel: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const bill = await service.cancelBill(
      db,
      requestContext(req),
      activeBranchId(req),
      id,
      req.body as CancelBillInput,
      req.ip ?? null,
    );
    res.json(success(bill));
  };

  return { create, list, get, receipt, cancel };
}
