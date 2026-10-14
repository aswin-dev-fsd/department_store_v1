import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useSelectBranch } from '../auth/mutations';
import { useMe } from '../auth/queries';
import { Button, Card, ErrorAlert, Notice } from '../components/ui';
import { t } from '../i18n/t';

/** A cashier chooses which of their branches to work in; also reached later to switch. */
export function BranchPickerPage() {
  const me = useMe().data;
  const select = useSelectBranch();
  const navigate = useNavigate();
  if (!me) return null;

  if (me.branches.length === 0) {
    return (
      <Card className="mx-auto w-full max-w-md">
        <h1 className="mb-3 text-xl font-semibold">{t('branchPicker.title')}</h1>
        <Notice>{t('branchPicker.none')}</Notice>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <h1 className="mb-1 text-xl font-semibold">{t('branchPicker.title')}</h1>
      <p className="mb-4 text-slate-700">{t('branchPicker.intro')}</p>
      {select.isError && (
        <div className="mb-4">
          <ErrorAlert>{errorMessage(select.error)}</ErrorAlert>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {me.branches.map((branch) => {
          const current = branch.id === me.activeBranchId;
          return (
            <li key={branch.id}>
              <Button
                variant={current ? 'primary' : 'secondary'}
                className="w-full justify-between text-left"
                disabled={select.isPending}
                aria-current={current ? 'true' : undefined}
                onClick={() =>
                  select.mutate(branch.id, {
                    onSuccess: () => void navigate('/', { replace: true }),
                  })
                }
              >
                <span>
                  {branch.code} — {branch.name}
                </span>
                {current && <span className="text-sm">{t('branchPicker.current')}</span>}
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
