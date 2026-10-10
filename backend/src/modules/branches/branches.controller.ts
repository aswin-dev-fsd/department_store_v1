import type { CreateBranchInput, IdParams, ListBranchesQuery, UpdateBranchInput } from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './branches.service.js';

/** Request handlers for /admin/branches — req/res only; the rules live in branches.service. */
export function branchesController({ db }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    res.json(success(await service.listBranches(db, req.query as unknown as ListBranchesQuery)));
  };

  const create: RequestHandler = async (req, res) => {
    const branch = await service.createBranch(
      db,
      requestContext(req),
      req.body as CreateBranchInput,
      req.ip ?? null,
    );
    res.status(201).json(success(branch));
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const branch = await service.updateBranch(
      db,
      requestContext(req),
      id,
      req.body as UpdateBranchInput,
      req.ip ?? null,
    );
    res.json(success(branch));
  };

  return { list, create, update };
}
