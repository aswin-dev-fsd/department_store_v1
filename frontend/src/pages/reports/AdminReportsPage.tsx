import {
  daysInRange,
  MAX_REPORT_DAYS,
  REPORTS,
  type DaySummary,
  type ItemSalesReport,
  type Page,
  type PurchaseRegister,
  type ReportName,
  type StockReportRow,
} from '@ds/shared';
import { useState } from 'react';
import { useBranchOptions } from '../../admin/queries';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { Card, ErrorAlert, SelectField, TextField } from '../../components/ui';
import { t } from '../../i18n/t';
import {
  isPaged,
  monthStart,
  reportDates,
  today,
  type AdminReportChoice,
} from '../../reports/paths';
import { useAdminReport, type AdminReportResult } from '../../reports/queries';
import {
  DaySummaryTable,
  ItemSalesTable,
  PrintButton,
  PurchaseRegisterTables,
  StockTable,
} from './ReportTables';

/** Why the chosen dates cannot be asked for yet; null when they can. */
function datesProblem(choice: AdminReportChoice): string | null {
  const dates = reportDates(choice.report);
  if (dates === 'day') return choice.date === '' ? t('reports.chooseDate') : null;
  if (dates === 'none') return null;
  if (choice.from === '' || choice.to === '') return t('reports.chooseRange');
  if (choice.to < choice.from) return t('reports.rangeBackwards');
  if (daysInRange(choice.from, choice.to) > MAX_REPORT_DAYS) {
    return t('reports.rangeTooLong', { days: MAX_REPORT_DAYS });
  }
  return null;
}

/** The chosen report's answer, drawn with its own table. */
function ReportBody({ result }: { result: AdminReportResult }) {
  switch (result.report) {
    case 'day-summary':
      return <DaySummaryTable summary={result.data as DaySummary} />;
    case 'item-sales':
      return <ItemSalesTable report={result.data as ItemSalesReport} />;
    case 'stock':
    case 'low-stock':
      return (
        <StockTable
          page={result.data as Page<StockReportRow>}
          low={result.report === 'low-stock'}
        />
      );
    case 'purchase-register':
      return <PurchaseRegisterTables register={result.data as PurchaseRegister} />;
  }
}

/**
 * Reports for the Admin (D-22): any of the reports, for one branch or every branch, over a day or
 * a range. Tables carry totals rows and print on A4 without the menus.
 */
export function AdminReportsPage() {
  const branches = useBranchOptions();
  const now = today();
  const [choice, setChoice] = useState<AdminReportChoice>({
    report: 'day-summary',
    branchId: null,
    date: now,
    from: monthStart(now),
    to: now,
  });
  const [offset, setOffset] = useState(0);
  const problem = datesProblem(choice);
  const report = useAdminReport(choice, offset, problem === null);
  const dates = reportDates(choice.report);
  const branchName =
    choice.branchId === null
      ? t('reports.allBranches')
      : (branches.data?.find((branch) => branch.id === choice.branchId)?.name ?? '');

  /** A new choice starts again from the first page. */
  function choose(next: Partial<AdminReportChoice>) {
    setChoice({ ...choice, ...next });
    setOffset(0);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t(`reports.name.${choice.report}`)}</h1>
          <p className="text-slate-700">{branchName}</p>
        </div>
        <PrintButton />
      </header>

      <Card className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
        <SelectField
          label={t('reports.report')}
          value={choice.report}
          onChange={(event) => choose({ report: event.target.value as ReportName })}
        >
          {REPORTS.map((name) => (
            <option key={name} value={name}>
              {t(`reports.name.${name}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('reports.branch')}
          value={choice.branchId === null ? '' : String(choice.branchId)}
          onChange={(event) =>
            choose({ branchId: event.target.value === '' ? null : Number(event.target.value) })
          }
        >
          <option value="">{t('reports.allBranches')}</option>
          {(branches.data ?? []).map((branch) => (
            <option key={branch.id} value={String(branch.id)}>
              {`${branch.code} — ${branch.name}`}
            </option>
          ))}
        </SelectField>
        {dates === 'day' && (
          <TextField
            label={t('reports.date')}
            type="date"
            value={choice.date}
            onChange={(event) => choose({ date: event.target.value })}
          />
        )}
        {dates === 'range' && (
          <>
            <TextField
              label={t('reports.from')}
              type="date"
              value={choice.from}
              onChange={(event) => choose({ from: event.target.value })}
            />
            <TextField
              label={t('reports.to')}
              type="date"
              value={choice.to}
              onChange={(event) => choose({ to: event.target.value })}
            />
          </>
        )}
      </Card>

      {problem ? (
        <ErrorAlert>{problem}</ErrorAlert>
      ) : report.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : report.isError && !report.data ? (
        <QueryProblem error={report.error} onRetry={() => void report.refetch()} />
      ) : report.data.report !== choice.report ? (
        <p role="status">{t('common.loading')}</p>
      ) : (
        <>
          <ReportBody result={report.data} />
          {isPaged(choice.report) && (
            <div className="print:hidden">
              <Pager
                page={report.data.data as Page<unknown>}
                busy={report.isPlaceholderData}
                onOffsetChange={setOffset}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
