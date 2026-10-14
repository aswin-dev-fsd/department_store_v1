import { updateSettingsSchema } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { settingsToForm, type SettingsFormValues } from '../../admin/forms';
import { useUpdateSettings } from '../../admin/mutations';
import { useSettings } from '../../admin/queries';
import { QueryProblem } from '../../components/QueryProblem';
import { Button, Card, ErrorAlert, Notice, TextField } from '../../components/ui';
import { describeFailure, validateForm, type FieldErrors } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';

interface SettingsFormProps {
  initial: SettingsFormValues;
  update: ReturnType<typeof useUpdateSettings>;
}

function SettingsForm({ initial, update }: SettingsFormProps) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  /** Editing again clears the "saved" notice. */
  function change(next: SettingsFormValues) {
    if (update.isSuccess) update.reset();
    setValues(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (update.isPending) return;
    const result = validateForm(updateSettingsSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    update.mutate(result.data);
  }

  const failure = describeFailure(update.error);
  const fieldErrors = { ...failure.fields, ...errors };

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
      {update.isSuccess && <Notice>{t('settings.saved')}</Notice>}
      {failure.message && <ErrorAlert>{failure.message}</ErrorAlert>}
      <TextField
        label={t('settings.businessName')}
        name="businessName"
        autoComplete="off"
        value={values.businessName}
        error={fieldErrors.businessName}
        readOnly={update.isPending}
        onChange={(event) => change({ ...values, businessName: event.target.value })}
      />
      <TextField
        label={t('settings.address')}
        name="address"
        autoComplete="off"
        value={values.address}
        error={fieldErrors.address}
        readOnly={update.isPending}
        onChange={(event) => change({ ...values, address: event.target.value })}
      />
      <TextField
        label={t('settings.phone')}
        name="phone"
        type="tel"
        autoComplete="off"
        value={values.phone}
        error={fieldErrors.phone}
        readOnly={update.isPending}
        onChange={(event) => change({ ...values, phone: event.target.value })}
      />
      <div>
        <Button type="submit" disabled={update.isPending} aria-busy={update.isPending}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}

/** Admin → Settings: the business name, address and phone shown on screens and bills. */
export function SettingsPage() {
  const settings = useSettings();
  // Lives here, not in the form, so "saved" survives the form reloading with the saved values
  const update = useUpdateSettings();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
        <p className="text-slate-700">{t('settings.intro')}</p>
      </header>
      {settings.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : settings.isError ? (
        <QueryProblem error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <Card>
          <SettingsForm
            key={settings.data.updatedAt}
            initial={settingsToForm(settings.data)}
            update={update}
          />
        </Card>
      )}
    </div>
  );
}
