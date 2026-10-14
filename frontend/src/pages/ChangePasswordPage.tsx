import { changePasswordSchema, PASSWORD_MIN_LENGTH } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useChangePassword } from '../auth/mutations';
import { useMe } from '../auth/queries';
import { Button, Card, ErrorAlert, Notice, TextField } from '../components/ui';
import { serverFieldErrors, validateForm, type FieldErrors } from '../forms/fieldErrors';
import { t } from '../i18n/t';

const EMPTY = { currentPassword: '', newPassword: '', confirm: '' };

/**
 * Replace the password. Forced after a first login or a reset (nothing else is reachable
 * until it is done); otherwise reached from the header.
 */
export function ChangePasswordPage() {
  const forced = useMe().data?.user.mustChangePassword ?? false;
  const change = useChangePassword();
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showPasswords, setShowPasswords] = useState(false);
  const [done, setDone] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (change.isPending) return;
    setDone(false);
    const { confirm, ...fields } = values;
    const result = validateForm(changePasswordSchema, fields);
    const problems: FieldErrors = result.ok ? {} : result.errors;
    if (confirm !== values.newPassword) problems.confirm = t('changePassword.mismatch');
    setErrors(problems);
    if (!result.ok || problems.confirm) return;

    change.mutate(result.data, {
      onSuccess: () => {
        setValues(EMPTY);
        // After a forced change the only sensible next step is the app; otherwise confirm in place
        if (forced) void navigate('/', { replace: true });
        else setDone(true);
      },
    });
  }

  const fieldErrors = { ...serverFieldErrors(change.error), ...errors };
  const showAlert = change.isError && Object.keys(serverFieldErrors(change.error)).length === 0;
  const inputType = showPasswords ? 'text' : 'password';

  return (
    <Card className="mx-auto w-full max-w-md">
      <h1 className="mb-2 text-xl font-semibold">{t('changePassword.title')}</h1>
      {forced && <Notice>{t('changePassword.required')}</Notice>}
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
        {done && <Notice>{t('changePassword.done')}</Notice>}
        {showAlert && <ErrorAlert>{errorMessage(change.error)}</ErrorAlert>}
        <TextField
          label={t('changePassword.current')}
          name="currentPassword"
          type={inputType}
          autoComplete="current-password"
          autoFocus
          value={values.currentPassword}
          error={fieldErrors.currentPassword}
          readOnly={change.isPending}
          onChange={(event) => setValues({ ...values, currentPassword: event.target.value })}
        />
        <TextField
          label={t('changePassword.new')}
          name="newPassword"
          type={inputType}
          autoComplete="new-password"
          hint={t('changePassword.hint', { min: PASSWORD_MIN_LENGTH })}
          value={values.newPassword}
          error={fieldErrors.newPassword}
          readOnly={change.isPending}
          onChange={(event) => setValues({ ...values, newPassword: event.target.value })}
        />
        <TextField
          label={t('changePassword.confirm')}
          name="confirm"
          type={inputType}
          autoComplete="new-password"
          value={values.confirm}
          error={fieldErrors.confirm}
          readOnly={change.isPending}
          onChange={(event) => setValues({ ...values, confirm: event.target.value })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={showPasswords}
            onChange={(event) => setShowPasswords(event.target.checked)}
          />
          {t('changePassword.show')}
        </label>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={change.isPending} aria-busy={change.isPending}>
            {change.isPending ? t('changePassword.submitting') : t('changePassword.submit')}
          </Button>
          {!forced && (
            <Link
              to="/"
              className="inline-flex h-11 items-center rounded-md px-4 text-blue-800 underline underline-offset-4"
            >
              {t('changePassword.cancel')}
            </Link>
          )}
        </div>
      </form>
    </Card>
  );
}
