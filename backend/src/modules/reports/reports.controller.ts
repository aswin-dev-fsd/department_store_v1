import type {
  AdminDaySummaryQuery,
  AdminItemSalesQuery,
  AdminPurchaseRegisterQuery,
  AdminStockReportQuery,
  OwnDaySummaryQuery,
  OwnStockReportQuery,
  ReportParams,
} from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { activeBranchId } from '../../lib/branch-scope.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import { requireBranchExists } from '../stock/stock.service.js';
import { daySummary } from './day-summary.service.js';
import { itemSales } from './item-sales.service.js';
import { purchaseRegister } from './purchase-register.service.js';
import { lowStockReport, stockReport } from './stock-report.service.js';

/**
 * Request handlers for /reports (a cashier: their own day, their branch's stock) and
 * /admin/reports/:report (the Admin: any report, one branch or all). Who sees what is decided
 * here, by the filter each handler passes; the figures are the report services'.
 */
export function reportsController({ db }: AppDeps) {
  /** A cashier's own figures in the branch they work in; nothing in the query can widen it. */
  const ownDaySummary: RequestHandler = async (req, res) => {
    const { date } = req.query as unknown as OwnDaySummaryQuery;
    const summary = await daySummary(db, {
      date,
      branchId: activeBranchId(req),
      cashierId: requestContext(req).user.id,
    });
    res.json(success(summary));
  };

  const ownStock =
    (low: boolean): RequestHandler =>
    async (req, res) => {
      const query = req.query as unknown as OwnStockReportQuery;
      const report = low ? lowStockReport : stockReport;
      res.json(success(await report(db, { ...query, branchId: activeBranchId(req) })));
    };

  /** Any report for the Admin; leaving out ?branchId= covers every branch. */
  const admin: RequestHandler = async (req, res) => {
    const { report } = req.params as unknown as ReportParams;
    const { branchId } = req.query as { branchId?: number };
    if (branchId !== undefined) await requireBranchExists(db, branchId);

    switch (report) {
      case 'day-summary':
        res.json(success(await daySummary(db, req.query as unknown as AdminDaySummaryQuery)));
        return;
      case 'item-sales':
        res.json(success(await itemSales(db, req.query as unknown as AdminItemSalesQuery)));
        return;
      case 'stock':
      case 'low-stock': {
        const query = req.query as unknown as AdminStockReportQuery;
        const page = report === 'stock' ? stockReport(db, query) : lowStockReport(db, query);
        res.json(success(await page));
        return;
      }
      case 'purchase-register':
        res.json(
          success(await purchaseRegister(db, req.query as unknown as AdminPurchaseRegisterQuery)),
        );
        return;
    }
  };

  return {
    ownDaySummary,
    ownStock: ownStock(false),
    ownLowStock: ownStock(true),
    admin,
  };
}
