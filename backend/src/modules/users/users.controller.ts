import type {
  CreateUserInput,
  IdParams,
  ListUsersQuery,
  SetUserBranchesInput,
  UpdateUserInput,
} from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './users.service.js';

/** Request handlers for /admin/users — req/res only; the rules live in users.service. */
export function usersController({ db }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    res.json(success(await service.listUsers(db, req.query as unknown as ListUsersQuery)));
  };

  const create: RequestHandler = async (req, res) => {
    const created = await service.createUser(
      db,
      requestContext(req),
      req.body as CreateUserInput,
      req.ip ?? null,
    );
    res.status(201).json(success(created));
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const user = await service.updateUser(
      db,
      requestContext(req),
      id,
      req.body as UpdateUserInput,
      req.ip ?? null,
    );
    res.json(success(user));
  };

  const resetPassword: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    res.json(success(await service.resetPassword(db, requestContext(req), id, req.ip ?? null)));
  };

  const setBranches: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const user = await service.setUserBranches(
      db,
      requestContext(req),
      id,
      req.body as SetUserBranchesInput,
      req.ip ?? null,
    );
    res.json(success(user));
  };

  return { list, create, update, resetPassword, setBranches };
}
