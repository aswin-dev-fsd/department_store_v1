import type { UserSummary } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { branchChoices, hasChanged, toggleBranch } from '../../admin/branchChoices';
import { useSetUserBranches } from '../../admin/mutations';
import { useBranchOptions } from '../../admin/queries';
import { QueryProblem } from '../../components/QueryProblem';
import { Button, ErrorAlert } from '../../components/ui';
import { describeFailure } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';

interface UserBranchesPanelProps {
  user: UserSummary;
  /** Runs after a successful save, and when the Admin cancels. */
  onClose: () => void;
}

/** A checkbox per branch for mapping one cashier to the branches they may work in. */
export function UserBranchesPanel({ user, onClose }: UserBranchesPanelProps) {
  const options = useBranchOptions();
  const setBranches = useSetUserBranches();
  const [selected, setSelected] = useState(() =>
    user.branches.map((branch) => branch.id).sort((a, b) => a - b),
  );

  if (options.isPending) {
    return (
      <p role="status" className="mt-4 text-sm text-slate-700">
        {t('users.branchesLoading')}
      </p>
    );
  }
  if (options.isError) {
    return (
      <div className="mt-4">
        <QueryProblem error={options.error} onRetry={() => void options.refetch()} />
      </div>
    );
  }

  const choices = branchChoices(options.data, user.branches, selected);
  if (choices.length === 0) {
    return (
      <p className="mt-4 text-sm text-slate-700">
        {t('users.branchesNone')}{' '}
        <Link to="/admin/branches" className="text-blue-800 underline underline-offset-4">
          {t('users.branchesNoneLink')}
        </Link>
      </p>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (setBranches.isPending || !hasChanged(user.branches, selected)) return;
    setBranches.mutate({ id: user.id, branchIds: selected }, { onSuccess: onClose });
  }

  const failure = describeFailure(setBranches.error);

  return (
    <form onSubmit={submit} className="mt-4 flex max-w-xl flex-col gap-3">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium text-slate-800">
          {t('users.branchesTitle', { name: user.fullName })}
        </legend>
        <p className="mb-1 text-sm text-slate-600">{t('users.branchesHint')}</p>
        {choices.map((choice) => (
          <label key={choice.id} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={choice.checked}
              disabled={setBranches.isPending}
              onChange={() => setSelected(toggleBranch(selected, choice.id))}
            />
            <span>
              <span className="font-mono">{choice.code}</span> — {choice.name}
              {choice.inactive && (
                <span className="ml-2 text-sm text-amber-800">{t('users.branchInactiveTag')}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      {failure.message && <ErrorAlert>{failure.message}</ErrorAlert>}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={setBranches.isPending || !hasChanged(user.branches, selected)}
          aria-busy={setBranches.isPending}
        >
          {setBranches.isPending ? t('common.saving') : t('users.branchesSave')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
