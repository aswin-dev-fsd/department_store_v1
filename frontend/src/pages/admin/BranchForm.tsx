import { createBranchSchema, updateBranchSchema, type Branch } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { branchToForm, EMPTY_BRANCH_FORM } from '../../admin/forms';
import { useCreateBranch, useUpdateBranch } from '../../admin/mutations';
import { Button, Card, ErrorAlert, TextAreaField, TextField } from '../../components/ui';
import { describeFailure, validateForm, type FieldErrors } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';

interface BranchFormProps {
  /** The branch to edit; leave out to add a new one. */
  branch?: Branch;
  /** Runs after a successful save, and when the Admin cancels. */
  onClose: () => void;
}

/** Add a branch, or edit the one given. */
export function BranchForm({ branch, onClose }: BranchFormProps) {
  const create = useCreateBranch();
  const update = useUpdateBranch();
  const mutation = branch ? update : create;
  const [values, setValues] = useState(branch ? branchToForm(branch) : EMPTY_BRANCH_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (mutation.isPending) return;

    if (branch) {
      const result = validateForm(updateBranchSchema, values);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
      update.mutate({ id: branch.id, changes: result.data }, { onSuccess: onClose });
    } else {
      const result = validateForm(createBranchSchema, values);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
      create.mutate(result.data, { onSuccess: onClose });
    }
  }

  const failure = describeFailure(mutation.error, { DUPLICATE_CODE: 'code' });
  const fieldErrors = { ...failure.fields, ...errors };
  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">
        {branch ? t('branches.editTitle', { code: branch.code }) : t('branches.createTitle')}
      </h2>
      <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
        {failure.message && <ErrorAlert>{failure.message}</ErrorAlert>}
        <TextField
          label={t('branches.code')}
          hint={t('branches.codeHint')}
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus={!branch}
          className="uppercase sm:max-w-40"
          value={values.code}
          error={fieldErrors.code}
          readOnly={mutation.isPending}
          onChange={(event) => set('code')(event.target.value)}
        />
        <TextField
          label={t('branches.name')}
          name="name"
          autoComplete="off"
          autoFocus={!!branch}
          value={values.name}
          error={fieldErrors.name}
          readOnly={mutation.isPending}
          onChange={(event) => set('name')(event.target.value)}
        />
        <TextField
          label={t('branches.address')}
          name="address"
          autoComplete="off"
          value={values.address}
          error={fieldErrors.address}
          readOnly={mutation.isPending}
          onChange={(event) => set('address')(event.target.value)}
        />
        <TextField
          label={t('branches.phone')}
          name="phone"
          type="tel"
          autoComplete="off"
          value={values.phone}
          error={fieldErrors.phone}
          readOnly={mutation.isPending}
          onChange={(event) => set('phone')(event.target.value)}
        />
        <TextAreaField
          label={t('branches.billFooter')}
          hint={t('branches.billFooterHint')}
          name="billFooter"
          value={values.billFooter}
          error={fieldErrors.billFooter}
          readOnly={mutation.isPending}
          onChange={(event) => set('billFooter')(event.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            {mutation.isPending
              ? branch
                ? t('common.saving')
                : t('branches.creating')
              : branch
                ? t('common.save')
                : t('branches.create')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
