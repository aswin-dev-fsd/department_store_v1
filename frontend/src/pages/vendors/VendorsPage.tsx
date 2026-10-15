import type { Vendor } from '@ds/shared';
import { useState } from 'react';
import {
  DEFAULT_VENDOR_FILTERS,
  STATUS_OPTIONS,
  type StatusFilter,
  type VendorFilters,
} from '../../catalog/filters';
import { useUpdateVendor } from '../../catalog/mutations';
import { useVendors } from '../../catalog/queries';
import { ConfirmBar } from '../../components/ConfirmBar';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { SearchBox } from '../../components/SearchBox';
import { StatusBadge } from '../../components/StatusBadge';
import { Button, Card, ErrorAlert, SelectField } from '../../components/ui';
import { describeFailure } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';
import { VendorForm } from './VendorForm';

/** One vendor: its details, and the actions on it. */
function VendorCard({ vendor }: { vendor: Vendor }) {
  const [panel, setPanel] = useState<'edit' | 'deactivate' | null>(null);
  const update = useUpdateVendor();
  const failure = describeFailure(update.error);

  if (panel === 'edit') return <VendorForm vendor={vendor} onClose={() => setPanel(null)} />;

  function setActive(isActive: boolean) {
    update.mutate({ id: vendor.id, changes: { isActive } }, { onSuccess: () => setPanel(null) });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{vendor.name}</h2>
          {vendor.address && <p className="text-slate-700">{vendor.address}</p>}
          {vendor.phone && (
            <p className="text-sm text-slate-600">{t('vendors.phoneLine', { phone: vendor.phone })}</p>
          )}
          {vendor.gstin && (
            <p className="text-sm text-slate-600">
              {t('vendors.gstinLine', { gstin: vendor.gstin })}
            </p>
          )}
        </div>
        <StatusBadge tone={vendor.isActive ? 'green' : 'grey'}>
          {vendor.isActive ? t('badge.active') : t('badge.inactive')}
        </StatusBadge>
      </div>

      {failure.message && panel === null && (
        <div className="mt-3">
          <ErrorAlert>{failure.message}</ErrorAlert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => setPanel('edit')}>
          {t('common.edit')}
        </Button>
        {vendor.isActive ? (
          <Button variant="secondary" onClick={() => setPanel('deactivate')}>
            {t('vendors.deactivate')}
          </Button>
        ) : (
          <Button variant="secondary" disabled={update.isPending} onClick={() => setActive(true)}>
            {t('vendors.reactivate')}
          </Button>
        )}
      </div>

      {panel === 'deactivate' && (
        <ConfirmBar
          message={t('vendors.deactivateConfirm', { name: vendor.name })}
          confirmLabel={t('vendors.deactivateYes')}
          busy={update.isPending}
          error={failure.message}
          onConfirm={() => setActive(false)}
          onCancel={() => setPanel(null)}
        />
      )}
    </Card>
  );
}

/** Catalog → Vendors: search, add, edit, deactivate and reactivate. */
export function VendorsPage() {
  const [filters, setFilters] = useState<VendorFilters>(DEFAULT_VENDOR_FILTERS);
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const vendors = useVendors(filters, offset);

  /** A new search or filter starts again from the first page. */
  function applyFilters(next: VendorFilters) {
    setFilters(next);
    setOffset(0);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold">{t('vendors.title')}</h1>
          <p className="text-slate-700">{t('vendors.intro')}</p>
        </div>
        <Button disabled={creating} onClick={() => setCreating(true)}>
          {t('vendors.new')}
        </Button>
      </header>

      {creating && <VendorForm onClose={() => setCreating(false)} />}

      <Card className="flex flex-col gap-4">
        <SearchBox
          label={t('vendors.search')}
          applied={filters.search}
          onSearch={(search) => applyFilters({ ...filters, search })}
        />
        <div className="sm:max-w-80">
          <SelectField
            label={t('catalog.statusFilter')}
            name="statusFilter"
            value={filters.status}
            onChange={(event) =>
              applyFilters({ ...filters, status: event.target.value as StatusFilter })
            }
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </SelectField>
        </div>
      </Card>

      {vendors.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : vendors.isError && !vendors.data ? (
        <QueryProblem error={vendors.error} onRetry={() => void vendors.refetch()} />
      ) : (
        <>
          {vendors.data.items.length === 0 ? (
            <p className="text-slate-700">{t('vendors.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {vendors.data.items.map((vendor) => (
                <li key={vendor.id}>
                  <VendorCard vendor={vendor} />
                </li>
              ))}
            </ul>
          )}
          <Pager page={vendors.data} busy={vendors.isPlaceholderData} onOffsetChange={setOffset} />
        </>
      )}
    </div>
  );
}
