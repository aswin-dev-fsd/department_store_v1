import { BILL_STATUSES, formatPaise, normalisePhone, type BillSummary } from '@ds/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_BILL_FILTERS, type BillFilters } from '../../bills/paths';
import { useBills } from '../../bills/queries';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { SearchBox } from '../../components/SearchBox';
import { Card, ErrorAlert, SelectField, TextField } from '../../components/ui';
import { t } from '../../i18n/t';
import { formatDateTime } from '../../lib/dates';
import { BillStatusBadge } from './BillStatusBadge';

const linkButton =
  'inline-flex h-11 items-center justify-center rounded-md border border-slate-400 bg-white px-4 text-base font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

/** One bill in the list: its number, when, who, the customer, the total and the status. */
function BillRow({ bill }: { bill: BillSummary }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{bill.billNo}</h2>
        <p className="text-slate-700">
          {formatDateTime(bill.createdAt)} · {bill.cashier.fullName}
        </p>
        <p className="text-sm text-slate-600">
          {bill.customer
            ? t('bills.customerLine', {
                customer: bill.customer.name
                  ? `${bill.customer.name} (${bill.customer.phone})`
                  : bill.customer.phone,
              })
            : t('bills.walkIn')}{' '}
          · {formatPaise(bill.totalPaise)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <BillStatusBadge status={bill.status} />
        <Link to={`/bills/${bill.id}`} className={linkButton}>
          {t('bills.open')}
        </Link>
      </div>
    </Card>
  );
}

/** Bills: the branch's saved bills, newest first, found by number, date, phone or status. */
export function BillsPage() {
  const [filters, setFilters] = useState<BillFilters>(DEFAULT_BILL_FILTERS);
  const [offset, setOffset] = useState(0);
  const bills = useBills(filters, offset);
  const badPhone = filters.phone !== '' && normalisePhone(filters.phone) === null;

  /** A new filter starts again from the first page. */
  function applyFilters(next: Partial<BillFilters>) {
    setFilters({ ...filters, ...next });
    setOffset(0);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="text-xl font-semibold">{t('bills.title')}</h1>
        <p className="text-slate-700">{t('bills.intro')}</p>
      </header>

      <Card className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <SearchBox
            label={t('bills.billNoSearch')}
            applied={filters.billNo}
            onSearch={(billNo) => applyFilters({ billNo })}
          />
          <SearchBox
            label={t('bills.phoneSearch')}
            applied={filters.phone}
            onSearch={(phone) => applyFilters({ phone })}
          />
        </div>
        {badPhone && <ErrorAlert>{t('bills.phoneFormat')}</ErrorAlert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label={t('bills.from')}
            name="from"
            type="date"
            value={filters.from}
            onChange={(event) => applyFilters({ from: event.target.value })}
          />
          <TextField
            label={t('bills.to')}
            name="to"
            type="date"
            value={filters.to}
            onChange={(event) => applyFilters({ to: event.target.value })}
          />
          <SelectField
            label={t('bills.statusFilter')}
            name="status"
            value={filters.status}
            onChange={(event) =>
              applyFilters({ status: event.target.value as BillFilters['status'] })
            }
          >
            <option value="all">{t('bills.statusAll')}</option>
            {BILL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`bills.status.${status}`)}
              </option>
            ))}
          </SelectField>
        </div>
      </Card>

      {bills.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : bills.isError && !bills.data ? (
        <QueryProblem error={bills.error} onRetry={() => void bills.refetch()} />
      ) : (
        <>
          {bills.data.items.length === 0 ? (
            <p className="text-slate-700">{t('bills.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {bills.data.items.map((bill) => (
                <li key={bill.id}>
                  <BillRow bill={bill} />
                </li>
              ))}
            </ul>
          )}
          <Pager page={bills.data} busy={bills.isPlaceholderData} onOffsetChange={setOffset} />
        </>
      )}
    </div>
  );
}
