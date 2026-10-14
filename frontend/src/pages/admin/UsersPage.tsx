import { useRef, useState } from 'react';
import { useUsers } from '../../admin/queries';
import { useMe } from '../../auth/queries';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { TemporaryPassword } from '../../components/TemporaryPassword';
import { Button } from '../../components/ui';
import { t } from '../../i18n/t';
import { UserCard } from './UserCard';
import { UserCreateForm } from './UserCreateForm';

/** A one-time temporary password on screen, until the Admin presses Done. */
interface Secret {
  id: number;
  title: string;
  password: string;
}

/** Admin → Users: list, add, edit, branch mapping, reset password, deactivate and reactivate. */
export function UsersPage() {
  const me = useMe().data;
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  // A list, so a second password can never replace one the Admin has not copied yet
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const nextSecretId = useRef(0);
  const users = useUsers(offset);

  function showSecret(title: string, password: string) {
    const id = nextSecretId.current++;
    setSecrets((current) => [...current, { id, title, password }]);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold">{t('users.title')}</h1>
          <p className="text-slate-700">{t('users.intro')}</p>
        </div>
        <Button disabled={creating} onClick={() => setCreating(true)}>
          {t('users.new')}
        </Button>
      </header>

      {secrets.map((secret) => (
        <TemporaryPassword
          key={secret.id}
          title={secret.title}
          password={secret.password}
          onDone={() => setSecrets((current) => current.filter((other) => other.id !== secret.id))}
        />
      ))}

      {creating && (
        <UserCreateForm
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            showSecret(
              t('tempPassword.createdTitle', { username: created.user.username }),
              created.temporaryPassword,
            );
          }}
        />
      )}

      {users.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : users.isError && !users.data ? (
        <QueryProblem error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <>
          {users.data.items.length === 0 ? (
            <p className="text-slate-700">{t('users.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {users.data.items.map((user) => (
                <li key={user.id}>
                  <UserCard user={user} isSelf={user.id === me?.user.id} onSecret={showSecret} />
                </li>
              ))}
            </ul>
          )}
          <Pager page={users.data} busy={users.isPlaceholderData} onOffsetChange={setOffset} />
        </>
      )}
    </div>
  );
}
