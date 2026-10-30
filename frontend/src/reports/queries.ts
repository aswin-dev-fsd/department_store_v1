import type { DaySummary, Page, ReportName, StockReportRow } from '@ds/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { adminReportPath, ownDaySummaryPath, ownStockPath, type AdminReportChoice } from './paths';

// Query keys for the report screens all start with 'reports', and none with an auth key, so
// logging out or switching branch clears them (auth/cache.ts). Reports are read-only.

/** The cashier's own day summary for an IST business date. */
export function useOwnDaySummary(date: string) {
  return useQuery({
    queryKey: ['reports', 'own-day', date],
    enabled: date !== '',
    queryFn: () => api.get<DaySummary>(ownDaySummaryPath(date)),
  });
}

/** A page of the cashier's branch stock, or of its low stock. */
export function useOwnStock(low: boolean, offset: number) {
  return useQuery({
    queryKey: ['reports', low ? 'own-low-stock' : 'own-stock', offset],
    queryFn: () => api.get<Page<StockReportRow>>(ownStockPath(low, offset)),
    placeholderData: keepPreviousData,
  });
}

/** An Admin report's answer, labelled with the report it answers. */
export interface AdminReportResult {
  report: ReportName;
  data: unknown;
}

/**
 * The Admin's chosen report; nothing is asked for while `enabled` is false (dates still being
 * typed). The previous answer stays up while the next loads, labelled with its report, so the
 * screen never reads one report's answer as another's.
 */
export function useAdminReport(choice: AdminReportChoice, offset: number, enabled: boolean) {
  const path = adminReportPath(choice, offset);
  return useQuery({
    queryKey: ['reports', 'admin', path],
    enabled,
    queryFn: async (): Promise<AdminReportResult> => ({
      report: choice.report,
      data: await api.get<unknown>(path),
    }),
    placeholderData: keepPreviousData,
  });
}
