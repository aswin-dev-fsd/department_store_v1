import { formatPaise, type Item } from '@ds/shared';
import { useState } from 'react';
import {
  DEFAULT_ITEM_FILTERS,
  STATUS_OPTIONS,
  type ItemFilters,
  type StatusFilter,
} from '../../catalog/filters';
import { useUpdateItem } from '../../catalog/mutations';
import { useCategoryOptions, useItems } from '../../catalog/queries';
import { ConfirmBar } from '../../components/ConfirmBar';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { SearchBox } from '../../components/SearchBox';
import { StatusBadge } from '../../components/StatusBadge';
import { Button, Card, ErrorAlert, SelectField } from '../../components/ui';
import { describeFailure } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';
import { ItemForm } from './ItemForm';

/** One item: its details, and the actions on it. */
function ItemCard({ item, categoryName }: { item: Item; categoryName: string | null }) {
  const [panel, setPanel] = useState<'edit' | 'deactivate' | null>(null);
  const update = useUpdateItem();
  const failure = describeFailure(update.error);

  if (panel === 'edit') return <ItemForm item={item} onClose={() => setPanel(null)} />;

  function setActive(isActive: boolean) {
    update.mutate({ id: item.id, changes: { isActive } }, { onSuccess: () => setPanel(null) });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{item.name}</h2>
          <p className="font-mono text-sm text-slate-600">
            {item.code}
            {item.barcode ? ` · ${item.barcode}` : ''}
          </p>
        </div>
        <StatusBadge tone={item.isActive ? 'green' : 'grey'}>
          {item.isActive ? t('badge.active') : t('badge.inactive')}
        </StatusBadge>
      </div>

      <div className="mt-2 text-sm text-slate-700">
        <p>{t('items.categoryLine', { category: categoryName ?? t('items.noCategory') })}</p>
        <p>
          {t('items.priceLine', {
            mrp: formatPaise(item.mrpPaise),
            price: formatPaise(item.sellingPricePaise),
          })}
        </p>
        <p>{t('items.stockLine', { stock: item.stock })}</p>
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
        {item.isActive ? (
          <Button variant="secondary" onClick={() => setPanel('deactivate')}>
            {t('items.deactivate')}
          </Button>
        ) : (
          <Button variant="secondary" disabled={update.isPending} onClick={() => setActive(true)}>
            {t('items.reactivate')}
          </Button>
        )}
      </div>

      {panel === 'deactivate' && (
        <ConfirmBar
          message={t('items.deactivateConfirm', { name: item.name })}
          confirmLabel={t('items.deactivateYes')}
          busy={update.isPending}
          error={failure.message}
          onConfirm={() => setActive(false)}
          onCancel={() => setPanel(null)}
        />
      )}
    </Card>
  );
}

/** Catalog → Items: search, filter, add, edit, deactivate and reactivate. */
export function ItemsPage() {
  const [filters, setFilters] = useState<ItemFilters>(DEFAULT_ITEM_FILTERS);
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const items = useItems(filters, offset);
  const categories = useCategoryOptions().data ?? [];
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name] as const),
  );

  /** A new search or filter starts again from the first page. */
  function applyFilters(next: ItemFilters) {
    setFilters(next);
    setOffset(0);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold">{t('items.title')}</h1>
          <p className="text-slate-700">{t('items.intro')}</p>
        </div>
        <Button disabled={creating} onClick={() => setCreating(true)}>
          {t('items.new')}
        </Button>
      </header>

      {creating && <ItemForm onClose={() => setCreating(false)} />}

      <Card className="flex flex-col gap-4">
        <SearchBox
          label={t('items.search')}
          applied={filters.search}
          onSearch={(search) => applyFilters({ ...filters, search })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t('items.categoryFilter')}
            name="categoryFilter"
            value={filters.categoryId === null ? '' : String(filters.categoryId)}
            onChange={(event) =>
              applyFilters({
                ...filters,
                categoryId: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          >
            <option value="">{t('items.allCategories')}</option>
            {categories.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </SelectField>
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

      {items.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : items.isError && !items.data ? (
        <QueryProblem error={items.error} onRetry={() => void items.refetch()} />
      ) : (
        <>
          {items.data.items.length === 0 ? (
            <p className="text-slate-700">{t('items.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {items.data.items.map((item) => (
                <li key={item.id}>
                  <ItemCard
                    item={item}
                    categoryName={
                      item.categoryId === null ? null : (categoryNames.get(item.categoryId) ?? null)
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <Pager page={items.data} busy={items.isPlaceholderData} onOffsetChange={setOffset} />
        </>
      )}
    </div>
  );
}
