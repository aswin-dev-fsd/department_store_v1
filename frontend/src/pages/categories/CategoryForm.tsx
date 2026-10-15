import { createCategorySchema, updateCategorySchema, type Category } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { useCreateCategory, useUpdateCategory } from '../../catalog/mutations';
import { Button, Card, ErrorAlert, TextField } from '../../components/ui';
import { describeFailure, validateForm, type FieldErrors } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';

interface CategoryFormProps {
  /** The category to rename; leave out to add a new one. */
  category?: Category;
  /** Runs after a successful save, and when the person cancels. */
  onClose: () => void;
}

/** Add a category, or rename the one given. */
export function CategoryForm({ category, onClose }: CategoryFormProps) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const mutation = category ? update : create;
  const [name, setName] = useState(category?.name ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (mutation.isPending) return;

    if (category) {
      const result = validateForm(updateCategorySchema, { name });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
      update.mutate({ id: category.id, changes: result.data }, { onSuccess: onClose });
    } else {
      const result = validateForm(createCategorySchema, { name });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
      create.mutate(result.data, { onSuccess: onClose });
    }
  }

  const failure = describeFailure(mutation.error, { DUPLICATE_NAME: 'name' });
  const fieldErrors = { ...failure.fields, ...errors };

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">
        {category
          ? t('categories.editTitle', { name: category.name })
          : t('categories.createTitle')}
      </h2>
      <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
        {failure.message && <ErrorAlert>{failure.message}</ErrorAlert>}
        <TextField
          label={t('categories.name')}
          name="name"
          autoComplete="off"
          autoFocus
          value={name}
          error={fieldErrors.name}
          readOnly={mutation.isPending}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            {mutation.isPending
              ? category
                ? t('common.saving')
                : t('categories.creating')
              : category
                ? t('common.save')
                : t('categories.create')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
