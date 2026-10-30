import {
  adminReportQuerySchemas,
  ownDaySummaryQuerySchema,
  ownStockReportQuerySchema,
  reportParamsSchema,
  type ReportParams,
} from '@ds/shared';
import { Router, type RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireBranch, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { reportsController } from './reports.controller.js';

/**
 * /api/v1/reports — a cashier's reports (D-22), always for the branch they work in
 * - GET /day-summary?date=           their own bills that day (report:own-day-summary)
 * - GET /stock?categoryId=&limit=&offset=      the branch's stock (stock:read)
 * - GET /low-stock?categoryId=&limit=&offset=  items at or below their reorder level (stock:read)
 * Queries are strict: naming a cashier or a branch is 422. Every route needs a chosen branch
 * (403 NO_ACTIVE_BRANCH), after the permission check.
 */
export function reportsRoutes(deps: AppDeps): Router {
  const controller = reportsController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.get(
    '/day-summary',
    requirePermission('report:own-day-summary'),
    requireBranch,
    validate({ query: ownDaySummaryQuerySchema }),
    controller.ownDaySummary,
  );
  router.get(
    '/stock',
    requirePermission('stock:read'),
    requireBranch,
    validate({ query: ownStockReportQuerySchema }),
    controller.ownStock,
  );
  router.get(
    '/low-stock',
    requirePermission('stock:read'),
    requireBranch,
    validate({ query: ownStockReportQuerySchema }),
    controller.ownLowStock,
  );
  return router;
}

/** Validate the query with the schema of the report named in the (already validated) params. */
const validateReportQuery: RequestHandler = (req, res, next) => {
  const { report } = req.params as unknown as ReportParams;
  validate({ query: adminReportQuerySchemas[report] })(req, res, next);
};

/**
 * /api/v1/admin/reports — every report for the Admin (report:all), any branch
 * - GET /:report   day-summary?date=&branchId=&cashierId=
 *                  item-sales?from=&to=&branchId=&limit=&offset=
 *                  stock | low-stock?branchId=&categoryId=&limit=&offset=
 *                  purchase-register?from=&to=&branchId=
 * Leaving out branchId covers every branch; a branch that does not exist is 404. A date range is
 * at most 366 days (422).
 */
export function adminReportsRoutes(deps: AppDeps): Router {
  const controller = reportsController(deps);
  const router = Router();
  router.use(requireAuth(deps.db));
  router.get(
    '/:report',
    requirePermission('report:all'),
    validate({ params: reportParamsSchema }),
    validateReportQuery,
    controller.admin,
  );
  return router;
}
