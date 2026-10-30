import { formatPaise } from '@ds/shared';
import { useState } from 'react';
import { useMe } from '../../auth/queries';
import { QueryProblem } from '../../components/QueryProblem';
import { Card, TextField } from '../../components/ui';
import { t } from '../../i18n/t';
import { today } from '../../reports/paths';
import { useOwnDaySummary } from '../../reports/queries';
import { DayTotalsList, PrintButton } from './ReportTables';

/**
 * Reports → My day-end (overview §7.7): the cashier's own bills on a day (today by default) in the
 * branch they work in, laid out for counting the drawer: the cash to expect first, then UPI and
 * card to compare with the payment apps and the card machine, then the whole day.
 */
export function MyDayEndPage() {
  const me = useMe().data;
  const branch = me?.branches.find((candidate) => candidate.id === me.activeBranchId);
  const [date, setDate] = useState(today());
  const summary = useOwnDaySummary(date);
  const totals = summary.data?.totals;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('reports.myDayTitle')}</h1>
          <p className="text-slate-700">
            {t('reports.myDayLine', {
              name: me?.user.fullName ?? '',
              branch: branch ? `${branch.code} — ${branch.name}` : '',
              date,
            })}
          </p>
        </div>
        <PrintButton />
      </header>

      <Card className="print:hidden">
        <div className="sm:max-w-60">
          <TextField
            label={t('reports.date')}
            type="date"
            value={date}
            max={today()}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      </Card>

      {date === '' ? (
        <p className="text-slate-700">{t('reports.chooseDate')}</p>
      ) : summary.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : summary.isError ? (
        <QueryProblem error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        totals && (
          <>
            <Card>
              <h2 className="mb-3 text-lg font-semibold">{t('reports.drawerTitle')}</h2>
              <dl className="report-list grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-sm text-slate-600">{t('reports.cashExpected')}</dt>
                  <dd className="text-2xl font-semibold">{formatPaise(totals.payments.cash)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">{t('receipt.mode.upi')}</dt>
                  <dd className="text-2xl font-semibold">{formatPaise(totals.payments.upi)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">{t('receipt.mode.card')}</dt>
                  <dd className="text-2xl font-semibold">{formatPaise(totals.payments.card)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-slate-600">{t('reports.drawerHint')}</p>
            </Card>
            <Card>
              <h2 className="mb-3 text-lg font-semibold">{t('reports.dayTitle')}</h2>
              <DayTotalsList totals={totals} />
            </Card>
          </>
        )
      )}
    </div>
  );
}
