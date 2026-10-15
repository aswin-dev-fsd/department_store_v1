import type { Db } from '@ds/database';
import { can, type ItemIdParams, type ListMovementsQuery, type ListStockQuery } from '@ds/shared';
import type { Request, RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { activeBranchId } from '../../lib/branch-scope.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './stock.service.js';

/**
 * The branch a stock read is about. A cashier reads the branch they work in: naming it with
 * ?branchId= is accepted, naming another is 403. Someone who may see every branch (`report:all`,
 * the Admin, who works in no branch) must name it with ?branchId=, and it must exist.
 */
async function branchToRead(db: Db, req: Request, asked: number | undefined): Promise<number> {
  if (!can(requestContext(req).user.role, 'report:all')) {
    const own = activeBranchId(req);
    if (asked !== undefined && asked !== own) {
      throw new ForbiddenError('You can only view the stock of the branch you work in');
    }
    return own;
  }
  if (asked === undefined) {
    throw new ValidationError('Invalid request data', [
      { path: 'query.branchId', message: 'Choose a branch' },
    ]);
  }
  await service.requireBranchExists(db, asked);
  return asked;
}

/** Request handlers for /stock — req/res only; the queries live in stock.service. */
export function stockController({ db }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    const query = req.query as unknown as ListStockQuery;
    const branchId = await branchToRead(db, req, query.branchId);
    res.json(success(await service.listStock(db, branchId, query)));
  };

  const movements: RequestHandler = async (req, res) => {
    const { itemId } = req.params as unknown as ItemIdParams;
    const query = req.query as unknown as ListMovementsQuery;
    const branchId = await branchToRead(db, req, query.branchId);
    res.json(success(await service.listMovements(db, branchId, itemId, query)));
  };

  return { list, movements };
}
