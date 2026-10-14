import type {
  CreateCategoryInput,
  IdParams,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { activeBranchId } from '../../lib/branch-scope.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './categories.service.js';

/** Request handlers for /categories — req/res only; the rules live in categories.service. */
export function categoriesController({ db }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    res.json(
      success(
        await service.listCategories(
          db,
          activeBranchId(req),
          req.query as unknown as ListCategoriesQuery,
        ),
      ),
    );
  };

  const create: RequestHandler = async (req, res) => {
    const category = await service.createCategory(
      db,
      requestContext(req),
      activeBranchId(req),
      req.body as CreateCategoryInput,
      req.ip ?? null,
    );
    res.status(201).json(success(category));
  };

  const rename: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const category = await service.renameCategory(
      db,
      requestContext(req),
      activeBranchId(req),
      id,
      req.body as UpdateCategoryInput,
      req.ip ?? null,
    );
    res.json(success(category));
  };

  return { list, create, rename };
}
