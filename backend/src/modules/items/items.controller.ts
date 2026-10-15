import type {
  CreateItemInput,
  IdParams,
  ListItemsQuery,
  LookupItemQuery,
  UpdateItemInput,
} from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { activeBranchId } from '../../lib/branch-scope.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './items.service.js';

/** Request handlers for /items — req/res only; the rules live in items.service. */
export function itemsController({ db }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    res.json(
      success(
        await service.listItems(db, activeBranchId(req), req.query as unknown as ListItemsQuery),
      ),
    );
  };

  const lookup: RequestHandler = async (req, res) => {
    res.json(
      success(
        await service.lookupItem(db, activeBranchId(req), req.query as unknown as LookupItemQuery),
      ),
    );
  };

  const create: RequestHandler = async (req, res) => {
    const item = await service.createItem(
      db,
      requestContext(req),
      activeBranchId(req),
      req.body as CreateItemInput,
      req.ip ?? null,
    );
    res.status(201).json(success(item));
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const item = await service.updateItem(
      db,
      requestContext(req),
      activeBranchId(req),
      id,
      req.body as UpdateItemInput,
      req.ip ?? null,
    );
    res.json(success(item));
  };

  return { list, lookup, create, update };
}
