import { useState } from 'react';
import { useMe } from '../../auth/queries';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { t } from '../../i18n/t';
import { useOwnStock } from '../../reports/queries';
import { PrintButton, StockTable } from './ReportTables';

/** Reports → Stock or Low stock: the branch the cashier works in (D-22), printable. */
export function BranchStockReportPage({ low }: { low: boolean }) {
  const me = useMe().data;
  const branch = me?.branches.find((candidate) => candidate.id === me.activeBranchId);
  const [offset, setOffset] = useState(0);
  const stock = useOwnStock(low, offset);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {low ? t('reports.lowStockTitle') : t('reports.stockTitle')}
          </h1>
          {branch && <p className="text-slate-700">{`${branch.code} — ${branch.name}`}</p>}
          {low && <p className="text-sm text-slate-600">{t('reports.lowStockHint')}</p>}
        </div>
        <PrintButton />
      </header>

      {stock.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : stock.isError && !stock.data ? (
        <QueryProblem error={stock.error} onRetry={() => void stock.refetch()} />
      ) : (
        <>
          <StockTable page={stock.data} low={low} />
          <div className="print:hidden">
            <Pager page={stock.data} busy={stock.isPlaceholderData} onOffsetChange={setOffset} />
          </div>
        </>
      )}
    </div>
  );
}
