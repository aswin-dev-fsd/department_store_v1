import type { Category } from '@ds/shared';
import { useState } from 'react';
import { useCategories } from '../../catalog/queries';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { Button, Card } from '../../components/ui';
import { t } from '../../i18n/t';
import { CategoryForm } from './CategoryForm';

/** One category: its name, and the way to rename it. */
function CategoryCard({ category }: { category: Category }) {
  const [renaming, setRenaming] = useState(false);

  if (renaming) return <CategoryForm category={category} onClose={() => setRenaming(false)} />;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{category.name}</h2>
        <Button variant="secondary" onClick={() => setRenaming(true)}>
          {t('categories.rename')}
        </Button>
      </div>
    </Card>
  );
}

/** Catalog → Categories: list, add and rename. (A category is never deleted.) */
export function CategoriesPage() {
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const categories = useCategories(offset);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold">{t('categories.title')}</h1>
          <p className="text-slate-700">{t('categories.intro')}</p>
        </div>
        <Button disabled={creating} onClick={() => setCreating(true)}>
          {t('categories.new')}
        </Button>
      </header>

      {creating && <CategoryForm onClose={() => setCreating(false)} />}

      {categories.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : categories.isError && !categories.data ? (
        <QueryProblem error={categories.error} onRetry={() => void categories.refetch()} />
      ) : (
        <>
          {categories.data.items.length === 0 ? (
            <p className="text-slate-700">{t('categories.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {categories.data.items.map((category) => (
                <li key={category.id}>
                  <CategoryCard category={category} />
                </li>
              ))}
            </ul>
          )}
          <Pager
            page={categories.data}
            busy={categories.isPlaceholderData}
            onOffsetChange={setOffset}
          />
        </>
      )}
    </div>
  );
}
