import type {
  CancelPurchaseInput,
  IdParams,
  ListPurchasesQuery,
  PurchaseDraftInput,
} from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { activeBranchId } from '../../lib/branch-scope.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './purchases.service.js';

/** Request handlers for /purchases — req/res only; the rules live in purchases.service. */
export function purchasesController({ db }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    res.json(
      success(
        await service.listPurchases(
          db,
          activeBranchId(req),
          req.query as unknown as ListPurchasesQuery,
        ),
      ),
    );
  };

  const get: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    res.json(success(await service.getPurchase(db, activeBranchId(req), id)));
  };

  const create: RequestHandler = async (req, res) => {
    const purchase = await service.createPurchase(
      db,
      requestContext(req),
      activeBranchId(req),
      req.body as PurchaseDraftInput,
      req.ip ?? null,
    );
    res.status(201).json(success(purchase));
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const purchase = await service.updatePurchase(
      db,
      requestContext(req),
      activeBranchId(req),
      id,
      req.body as PurchaseDraftInput,
      req.ip ?? null,
    );
    res.json(success(purchase));
  };

  const post: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const purchase = await service.postPurchase(
      db,
      requestContext(req),
      activeBranchId(req),
      id,
      req.ip ?? null,
    );
    res.json(success(purchase));
  };

  const cancel: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const purchase = await service.cancelPurchase(
      db,
      requestContext(req),
      activeBranchId(req),
      id,
      req.body as CancelPurchaseInput,
      req.ip ?? null,
    );
    res.json(success(purchase));
  };

  return { list, get, create, update, post, cancel };
}
