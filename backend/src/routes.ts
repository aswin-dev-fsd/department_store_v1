import { Router } from 'express';
import type { AppDeps } from './deps.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { billsRoutes } from './modules/bills/bills.routes.js';
import { branchesRoutes } from './modules/branches/branches.routes.js';
import { categoriesRoutes } from './modules/categories/categories.routes.js';
import { customersRoutes } from './modules/customers/customers.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { importRoutes } from './modules/import/import.routes.js';
import { itemsRoutes } from './modules/items/items.routes.js';
import { purchasesRoutes } from './modules/purchases/purchases.routes.js';
import { adminReportsRoutes, reportsRoutes } from './modules/reports/reports.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { adjustmentsRoutes } from './modules/stock/adjustments.routes.js';
import { stockRoutes } from './modules/stock/stock.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { vendorsRoutes } from './modules/vendors/vendors.routes.js';

type Mount = readonly [path: string, routes: (deps: AppDeps) => Router];

/**
 * Every module router and its path under /api/v1, in mounting order. Exported so the security
 * test can list every route and check its permission and audit coverage.
 */
export const API_MOUNTS: readonly Mount[] = [
  ['/health', healthRoutes],
  ['/auth', authRoutes],
  // Ahead of the branches routes on the same prefix: it answers only its own path
  ['/admin/branches', importRoutes],
  ['/admin/branches', branchesRoutes],
  ['/admin/settings', settingsRoutes],
  ['/admin/reports', adminReportsRoutes],
  ['/admin/users', usersRoutes],
  ['/bills', billsRoutes],
  ['/categories', categoriesRoutes],
  ['/customers', customersRoutes],
  ['/items', itemsRoutes],
  ['/purchases', purchasesRoutes],
  ['/reports', reportsRoutes],
  // Before /stock, so an adjustment is handled (and authenticated) once
  ['/stock/adjustments', adjustmentsRoutes],
  ['/stock', stockRoutes],
  ['/vendors', vendorsRoutes],
];

/** Every API route, mounted by createApp under /api/v1. */
export function apiRoutes(deps: AppDeps): Router {
  const router = Router();
  for (const [path, routes] of API_MOUNTS) {
    router.use(path, routes(deps));
  }
  return router;
}
