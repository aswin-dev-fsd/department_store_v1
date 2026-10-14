import { createUserSchema, ROLES, type CreatedUser, type Role } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { EMPTY_USER_FORM } from '../../admin/forms';
import { useCreateUser } from '../../admin/mutations';
import { Button, Card, ErrorAlert, SelectField, TextField } from '../../components/ui';
import { describeFailure, validateForm, type FieldErrors } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';

interface UserCreateFormProps {
  /** Receives the new user and the one-time temporary password. */
  onCreated: (created: CreatedUser) => void;
  onCancel: () => void;
}

/** Add a user. The server makes the temporary password, so there is no password field. */
export function UserCreateForm({ onCreated, onCancel }: UserCreateFormProps) {
  const create = useCreateUser();
  const [values, setValues] = useState(EMPTY_USER_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (create.isPending) return;
    const result = validateForm(createUserSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    create.mutate(result.data, { onSuccess: onCreated });
  }

  const failure = describeFailure(create.error, { DUPLICATE_USERNAME: 'username' });
  const fieldErrors = { ...failure.fields, ...errors };

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">{t('users.createTitle')}</h2>
      <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
        {failure.message && <ErrorAlert>{failure.message}</ErrorAlert>}
        <TextField
          label={t('users.username')}
          hint={t('users.usernameHint')}
          name="username"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          value={values.username}
          error={fieldErrors.username}
          readOnly={create.isPending}
          onChange={(event) => setValues({ ...values, username: event.target.value })}
        />
        <TextField
          label={t('users.fullName')}
          name="fullName"
          autoComplete="off"
          value={values.fullName}
          error={fieldErrors.fullName}
          readOnly={create.isPending}
          onChange={(event) => setValues({ ...values, fullName: event.target.value })}
        />
        <SelectField
          label={t('users.role')}
          hint={t('users.roleHint')}
          name="role"
          value={values.role}
          error={fieldErrors.role}
          disabled={create.isPending}
          onChange={(event) => setValues({ ...values, role: event.target.value as Role })}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`role.${role}`)}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={create.isPending} aria-busy={create.isPending}>
            {create.isPending ? t('users.creating') : t('users.create')}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
