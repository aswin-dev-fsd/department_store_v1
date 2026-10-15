import type { StockLine } from '@ds/shared';
import { useState } from 'react';
import { useBranchOptions } from '../../admin/queries';
import { useMe } from '../../auth/queries';
import { useCategoryOptions } from '../../catalog/queries';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { StatusBadge } from '../../components/StatusBadge';
import { Button, Card, SelectField } from '../../components/ui';
import { t } from '../../i18n/t';
import { isLowStock } from '../../stock/display';
import { useStock } from '../../stock/queries';
import { MovementsPanel } from './MovementsPanel';

interface StockCardProps {
  line: StockLine;
  categoryName: string | null;
  /** The branch an Admin chose; null for a cashier. */
  branchId: number | null;
}

/** One item and how many are in stock, with its movement history one click away. */
function StockCard({ line, categoryName, branchId }: StockCardProps) {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{line.name}</h2>
          <p className="font-mono text-sm text-slate-600">
            {line.code}
            {line.barcode ? ` · ${line.barcode}` : ''}
          </p>
          {categoryName && (
            <p className="text-sm text-slate-700">
              {t('stock.categoryLine', { category: categoryName })}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold">{line.quantity}</p>
          <p className="text-sm text-slate-600">{t('stock.quantity')}</p>
        </div>
      </div>

      {(isLowStock(line) || !line.isActive) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {isLowStock(line) && <StatusBadge tone="amber">{t('stock.lowStock')}</StatusBadge>}
          {!line.isActive && <StatusBadge tone="grey">{t('badge.inactive')}</StatusBadge>}
        </div>
      )}

      <div className="mt-4">
        <Button
          variant="secondary"
          aria-expanded={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? t('stock.hideHistory') : t('stock.showHistory')}
        </Button>
      </div>

      {showHistory && <MovementsPanel itemId={line.itemId} branchId={branchId} />}
    </Card>
  );
}

/**
 * The stock list of one branch. A cashier passes no branch (they read the one they work in) and
 * can filter by its categories. An Admin passes the branch they chose; the categories API cannot
 * be asked about another branch, so there is no category filter for them.
 */
function StockView({ branchId }: { branchId: number | null }) {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const canFilterByCategory = branchId === null;
  const categories = useCategoryOptions(canFilterByCategory).data ?? [];
  const stock = useStock({ branchId, categoryId }, offset);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name] as const));

  return (
    <div className="flex flex-col gap-6">
      {canFilterByCategory && (
        <Card>
          <div className="sm:max-w-80">
            <SelectField
              label={t('stock.categoryFilter')}
              name="categoryFilter"
              value={categoryId === null ? '' : String(categoryId)}
              onChange={(event) => {
                setCategoryId(event.target.value === '' ? null : Number(event.target.value));
                // A new filter starts again from the first page
                setOffset(0);
              }}
            >
              <option value="">{t('stock.allCategories')}</option>
              {categories.map((category) => (
                <option key={category.id} value={String(category.id)}>
                  {category.name}
                </option>
              ))}
            </SelectField>
          </div>
        </Card>
      )}

      {stock.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : stock.isError && !stock.data ? (
        <QueryProblem error={stock.error} onRetry={() => void stock.refetch()} />
      ) : (
        <>
          {stock.data.items.length === 0 ? (
            <p className="text-slate-700">{t('stock.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {stock.data.items.map((line) => (
                <li key={line.itemId}>
                  <StockCard
                    line={line}
                    branchId={branchId}
                    categoryName={
                      line.categoryId === null ? null : (categoryNames.get(line.categoryId) ?? null)
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <Pager page={stock.data} busy={stock.isPlaceholderData} onOffsetChange={setOffset} />
        </>
      )}
    </div>
  );
}

/** What an Admin sees: choose a branch, then its stock. */
function AdminStock() {
  const branches = useBranchOptions();
  const [chosen, setChosen] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        {branches.isPending ? (
          <p role="status">{t('common.loading')}</p>
        ) : branches.isError ? (
          <QueryProblem error={branches.error} onRetry={() => void branches.refetch()} />
        ) : (
          <div className="sm:max-w-80">
            <SelectField
              label={t('stock.branch')}
              name="branch"
              value={chosen === null ? '' : String(chosen)}
              onChange={(event) =>
                setChosen(event.target.value === '' ? null : Number(event.target.value))
              }
            >
              <option value="">{t('stock.chooseBranchOption')}</option>
              {branches.data.map((branch) => (
                <option key={branch.id} value={String(branch.id)}>
                  {`${branch.code} — ${branch.name}`}
                </option>
              ))}
            </SelectField>
          </div>
        )}
      </Card>
      {chosen === null ? (
        <p className="text-slate-700">{t('stock.chooseBranchPrompt')}</p>
      ) : (
        // Another branch starts again: no filter, first page
        <StockView key={chosen} branchId={chosen} />
      )}
    </div>
  );
}

/** Stock → how many of each item the branch holds, and the history behind every number. */
export function StockPage() {
  const me = useMe().data;
  if (!me) return null;
  // The permission that already means "any branch" (overview §8): the Admin names the branch
  const readsAnyBranch = me.permissions.includes('report:all');

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="text-xl font-semibold">{t('stock.title')}</h1>
        <p className="text-slate-700">{t('stock.intro')}</p>
      </header>
      {readsAnyBranch ? <AdminStock /> : <StockView branchId={null} />}
    </div>
  );
}
