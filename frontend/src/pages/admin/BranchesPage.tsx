import type { Branch } from '@ds/shared';
import { useState } from 'react';
import { useUpdateBranch } from '../../admin/mutations';
import { useBranches } from '../../admin/queries';
import { ConfirmBar } from '../../components/ConfirmBar';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { StatusBadge } from '../../components/StatusBadge';
import { Button, Card, ErrorAlert } from '../../components/ui';
import { describeFailure } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';
import { BranchForm } from './BranchForm';

/** One branch: its details, and the actions on it. */
function BranchCard({ branch }: { branch: Branch }) {
  const [panel, setPanel] = useState<'edit' | 'deactivate' | null>(null);
  const update = useUpdateBranch();
  const failure = describeFailure(update.error);

  if (panel === 'edit') return <BranchForm branch={branch} onClose={() => setPanel(null)} />;

  function setActive(isActive: boolean) {
    update.mutate({ id: branch.id, changes: { isActive } }, { onSuccess: () => setPanel(null) });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            <span className="font-mono">{branch.code}</span> — {branch.name}
          </h2>
          <p className="text-slate-700">{branch.address}</p>
          {branch.phone && (
            <p className="text-sm text-slate-600">
              {t('branches.phoneLine', { phone: branch.phone })}
            </p>
          )}
        </div>
        <StatusBadge tone={branch.isActive ? 'green' : 'grey'}>
          {branch.isActive ? t('badge.active') : t('badge.inactive')}
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
        {branch.isActive ? (
          <Button variant="secondary" onClick={() => setPanel('deactivate')}>
            {t('branches.deactivate')}
          </Button>
        ) : (
          <Button variant="secondary" disabled={update.isPending} onClick={() => setActive(true)}>
            {t('branches.reactivate')}
          </Button>
        )}
      </div>

      {panel === 'deactivate' && (
        <ConfirmBar
          message={t('branches.deactivateConfirm', { code: branch.code })}
          confirmLabel={t('branches.deactivateYes')}
          busy={update.isPending}
          error={failure.message}
          onConfirm={() => setActive(false)}
          onCancel={() => setPanel(null)}
        />
      )}
    </Card>
  );
}

/** Admin → Branches: list, add, edit, deactivate and reactivate. */
export function BranchesPage() {
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const branches = useBranches(offset);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('branches.title')}</h1>
          <p className="text-slate-700">{t('branches.intro')}</p>
        </div>
        <Button disabled={creating} onClick={() => setCreating(true)}>
          {t('branches.new')}
        </Button>
      </header>

      {creating && <BranchForm onClose={() => setCreating(false)} />}

      {branches.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : branches.isError && !branches.data ? (
        <QueryProblem error={branches.error} onRetry={() => void branches.refetch()} />
      ) : (
        <>
          {branches.data.items.length === 0 ? (
            <p className="text-slate-700">{t('branches.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {branches.data.items.map((branch) => (
                <li key={branch.id}>
                  <BranchCard branch={branch} />
                </li>
              ))}
            </ul>
          )}
          <Pager
            page={branches.data}
            busy={branches.isPlaceholderData}
            onOffsetChange={setOffset}
          />
        </>
      )}
    </div>
  );
}
