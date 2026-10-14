import { updateUserSchema, type UserSummary } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { useResetPassword, useUpdateUser } from '../../admin/mutations';
import { ConfirmBar } from '../../components/ConfirmBar';
import { StatusBadge } from '../../components/StatusBadge';
import { Button, Card, ErrorAlert, TextField } from '../../components/ui';
import { describeFailure, validateForm, type FieldErrors } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';
import { UserBranchesPanel } from './UserBranchesPanel';

type Panel = 'name' | 'branches' | 'reset' | 'deactivate';

/** Change a user's full name. (Username and role are fixed once an account exists.) */
function UserNameForm({ user, onClose }: { user: UserSummary; onClose: () => void }) {
  const update = useUpdateUser();
  const [fullName, setFullName] = useState(user.fullName);
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (update.isPending) return;
    const result = validateForm(updateUserSchema, { fullName });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    update.mutate({ id: user.id, changes: result.data }, { onSuccess: onClose });
  }

  const failure = describeFailure(update.error);
  const fieldErrors = { ...failure.fields, ...errors };

  return (
    <form onSubmit={submit} noValidate className="mt-4 flex max-w-xl flex-col gap-3">
      {failure.message && <ErrorAlert>{failure.message}</ErrorAlert>}
      <TextField
        label={t('users.fullName')}
        name="fullName"
        autoComplete="off"
        autoFocus
        value={fullName}
        error={fieldErrors.fullName}
        readOnly={update.isPending}
        onChange={(event) => setFullName(event.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={update.isPending} aria-busy={update.isPending}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

interface UserCardProps {
  user: UserSummary;
  /** The logged-in Admin's own account: it cannot be deactivated or reset here. */
  isSelf: boolean;
  /** Hands a one-time temporary password to the page, which shows it until dismissed. */
  onSecret: (title: string, password: string) => void;
}

/** One user: details, and the actions on them. */
export function UserCard({ user, isSelf, onSecret }: UserCardProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const status = useUpdateUser();
  const passwordReset = useResetPassword();
  const failure = describeFailure(status.error ?? passwordReset.error);

  /** Open one panel (or close them all), forgetting the last attempt's error. */
  function open(next: Panel | null) {
    status.reset();
    passwordReset.reset();
    setPanel(next);
  }

  function setActive(isActive: boolean) {
    status.mutate({ id: user.id, changes: { isActive } }, { onSuccess: () => setPanel(null) });
  }

  function resetPassword() {
    passwordReset.mutate(user.id, {
      onSuccess: (reset) => {
        setPanel(null);
        onSecret(
          t('tempPassword.resetTitle', { username: user.username }),
          reset.temporaryPassword,
        );
      },
    });
  }

  const branchNames = user.branches
    .map((branch) =>
      branch.isActive ? branch.code : t('users.branchInactive', { code: branch.code }),
    )
    .join(', ');

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{user.fullName}</h2>
          <p className="font-mono text-sm text-slate-600">{user.username}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSelf && <StatusBadge tone="grey">{t('badge.you')}</StatusBadge>}
          <StatusBadge tone="grey">{t(`role.${user.role}`)}</StatusBadge>
          <StatusBadge tone={user.isActive ? 'green' : 'grey'}>
            {user.isActive ? t('badge.active') : t('badge.inactive')}
          </StatusBadge>
          {user.mustChangePassword && (
            <StatusBadge tone="amber">{t('badge.mustChangePassword')}</StatusBadge>
          )}
        </div>
      </div>

      {user.role === 'cashier' && (
        <p className="mt-2 text-sm text-slate-700">
          {user.branches.length > 0 ? (
            t('users.branchesLine', { branches: branchNames })
          ) : (
            <StatusBadge tone="amber">{t('badge.noBranch')}</StatusBadge>
          )}
        </p>
      )}

      {failure.message && panel !== 'reset' && panel !== 'deactivate' && (
        <div className="mt-3">
          <ErrorAlert>{failure.message}</ErrorAlert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => open('name')}>
          {t('users.edit')}
        </Button>
        {user.role === 'cashier' && (
          <Button variant="secondary" onClick={() => open('branches')}>
            {t('users.branches')}
          </Button>
        )}
        {!isSelf && (
          <Button variant="secondary" onClick={() => open('reset')}>
            {t('users.reset')}
          </Button>
        )}
        {!isSelf &&
          (user.isActive ? (
            <Button variant="secondary" onClick={() => open('deactivate')}>
              {t('users.deactivate')}
            </Button>
          ) : (
            <Button variant="secondary" disabled={status.isPending} onClick={() => setActive(true)}>
              {t('users.reactivate')}
            </Button>
          ))}
      </div>

      {panel === 'name' && <UserNameForm user={user} onClose={() => open(null)} />}
      {panel === 'branches' && <UserBranchesPanel user={user} onClose={() => open(null)} />}
      {panel === 'reset' && (
        <ConfirmBar
          message={t('users.resetConfirm', { name: user.fullName })}
          confirmLabel={t('users.resetYes')}
          busy={passwordReset.isPending}
          error={failure.message}
          onConfirm={resetPassword}
          onCancel={() => open(null)}
        />
      )}
      {panel === 'deactivate' && (
        <ConfirmBar
          message={t('users.deactivateConfirm', { name: user.fullName })}
          confirmLabel={t('users.deactivateYes')}
          busy={status.isPending}
          error={failure.message}
          onConfirm={() => setActive(false)}
          onCancel={() => open(null)}
        />
      )}
    </Card>
  );
}
