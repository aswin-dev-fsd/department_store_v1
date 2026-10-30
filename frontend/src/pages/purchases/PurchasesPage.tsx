import { formatPaise, PURCHASE_STATUSES, type PurchaseSummary } from '@ds/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { Card, SelectField, TextField } from '../../components/ui';
import { t } from '../../i18n/t';
import { DEFAULT_PURCHASE_FILTERS, type PurchaseFilters } from '../../purchases/paths';
import { usePurchases, useVendorOptions } from '../../purchases/queries';
import { PurchaseStatusBadge } from './PurchaseStatusBadge';

const linkButton =
  'inline-flex h-11 items-center justify-center rounded-md px-4 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

/** One purchase in the list: what it is, and a way to open it. */
function PurchaseRow({ purchase }: { purchase: PurchaseSummary }) {
  const isDraft = purchase.status === 'draft';
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">
          {t('purchases.invoiceLine', { invoice: purchase.vendorInvoiceNo })}
        </h2>
        <p className="text-slate-700">{purchase.vendor.name}</p>
        <p className="text-sm text-slate-600">
          {t('purchases.dateLine', { date: purchase.invoiceDate })} ·{' '}
          {formatPaise(purchase.totalPaise)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <PurchaseStatusBadge status={purchase.status} />
        <Link
          to={`/purchases/${purchase.id}`}
          className={`${linkButton} ${
            isDraft
              ? 'bg-blue-700 text-white hover:bg-blue-800'
              : 'border border-slate-400 bg-white text-slate-900 hover:bg-slate-100'
          }`}
        >
          {isDraft ? t('purchases.continue') : t('purchases.open')}
        </Link>
      </div>
    </Card>
  );
}

/** Purchases: the branch's purchase entries, filtered; drafts can be opened to continue. */
export function PurchasesPage() {
  const [filters, setFilters] = useState<PurchaseFilters>(DEFAULT_PURCHASE_FILTERS);
  const [offset, setOffset] = useState(0);
  const purchases = usePurchases(filters, offset);
  const vendors = useVendorOptions();

  /** A new filter starts again from the first page. */
  function applyFilters(next: Partial<PurchaseFilters>) {
    setFilters({ ...filters, ...next });
    setOffset(0);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold">{t('purchases.title')}</h1>
          <p className="text-slate-700">{t('purchases.intro')}</p>
        </div>
        <Link
          to="/purchases/new"
          className={`${linkButton} bg-blue-700 text-white hover:bg-blue-800`}
        >
          {t('purchases.new')}
        </Link>
      </header>

      <Card className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          label={t('purchases.statusFilter')}
          name="status"
          value={filters.status}
          onChange={(event) =>
            applyFilters({ status: event.target.value as PurchaseFilters['status'] })
          }
        >
          <option value="all">{t('purchases.statusAll')}</option>
          {PURCHASE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`purchases.status.${status}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('purchases.vendorFilter')}
          name="vendor"
          value={filters.vendorId === null ? '' : String(filters.vendorId)}
          onChange={(event) =>
            applyFilters({
              vendorId: event.target.value === '' ? null : Number(event.target.value),
            })
          }
        >
          <option value="">{t('purchases.vendorAll')}</option>
          {(vendors.data ?? []).map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t('purchases.from')}
          name="from"
          type="date"
          value={filters.from}
          onChange={(event) => applyFilters({ from: event.target.value })}
        />
        <TextField
          label={t('purchases.to')}
          name="to"
          type="date"
          value={filters.to}
          onChange={(event) => applyFilters({ to: event.target.value })}
        />
      </Card>

      {purchases.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : purchases.isError && !purchases.data ? (
        <QueryProblem error={purchases.error} onRetry={() => void purchases.refetch()} />
      ) : (
        <>
          {purchases.data.items.length === 0 ? (
            <p className="text-slate-700">{t('purchases.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {purchases.data.items.map((purchase) => (
                <li key={purchase.id}>
                  <PurchaseRow purchase={purchase} />
                </li>
              ))}
            </ul>
          )}
          <Pager
            page={purchases.data}
            busy={purchases.isPlaceholderData}
            onOffsetChange={setOffset}
          />
        </>
      )}
    </div>
  );
}
