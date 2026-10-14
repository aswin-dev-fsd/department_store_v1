import { loginSchema } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api/errors';
import { useLogin } from '../auth/mutations';
import { useSessionNotice } from '../auth/queries';
import { Button, Card, ErrorAlert, Notice, TextField } from '../components/ui';
import { serverFieldErrors, validateForm, type FieldErrors } from '../forms/fieldErrors';
import { t } from '../i18n/t';

/** Username and password. On success the route guard moves the visitor on. */
export function LoginPage() {
  const login = useLogin();
  const notice = useSessionNotice();
  const [values, setValues] = useState({ username: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (login.isPending) return;
    const result = validateForm(loginSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    login.mutate(result.data, {
      // Never leave a rejected password sitting in the box
      onError: () => setValues((current) => ({ ...current, password: '' })),
    });
  }

  const fieldErrors = { ...serverFieldErrors(login.error), ...errors };
  const showAlert = login.isError && Object.keys(serverFieldErrors(login.error)).length === 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">{t('app.name')}</h1>
        <h2 className="mb-4 text-lg text-slate-700">{t('login.title')}</h2>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {notice && <Notice>{t(notice)}</Notice>}
          {showAlert && <ErrorAlert>{errorMessage(login.error)}</ErrorAlert>}
          <TextField
            label={t('login.username')}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={values.username}
            error={fieldErrors.username}
            readOnly={login.isPending}
            onChange={(event) => setValues({ ...values, username: event.target.value })}
          />
          <TextField
            label={t('login.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            value={values.password}
            error={fieldErrors.password}
            readOnly={login.isPending}
            onChange={(event) => setValues({ ...values, password: event.target.value })}
          />
          <Button type="submit" disabled={login.isPending} aria-busy={login.isPending}>
            {login.isPending ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
