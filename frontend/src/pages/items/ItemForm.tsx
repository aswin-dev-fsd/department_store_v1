import { createItemSchema, updateItemSchema, type Item } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { convertItemForm, EMPTY_ITEM_FORM, itemToForm, toFormFields } from '../../catalog/forms';
import { useCreateItem, useUpdateItem } from '../../catalog/mutations';
import { useCategoryOptions } from '../../catalog/queries';
import { Button, Card, ErrorAlert, SelectField, TextField } from '../../components/ui';
import { describeFailure, validateForm, type FieldErrors } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';

interface ItemFormProps {
  /** The item to edit; leave out to add a new one. */
  item?: Item;
  /** Runs after a successful save, and when the person cancels. */
  onClose: () => void;
}

/** Add an item, or edit the one given. Prices are typed in rupees. */
export function ItemForm({ item, onClose }: ItemFormProps) {
  const create = useCreateItem();
  const update = useUpdateItem();
  const mutation = item ? update : create;
  const categories = useCategoryOptions();
  const [values, setValues] = useState(item ? itemToForm(item) : EMPTY_ITEM_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (mutation.isPending) return;

    // Prices go to the schemas in paise; text that is not a number is reported in plain words
    const { input, problems } = convertItemForm(values);
    if (item) {
      const result = validateForm(updateItemSchema, input);
      if (!result.ok || Object.keys(problems).length > 0) {
        setErrors({ ...(result.ok ? {} : toFormFields(result.errors)), ...problems });
        return;
      }
      setErrors({});
      update.mutate({ id: item.id, changes: result.data }, { onSuccess: onClose });
    } else {
      const result = validateForm(createItemSchema, input);
      if (!result.ok || Object.keys(problems).length > 0) {
        setErrors({ ...(result.ok ? {} : toFormFields(result.errors)), ...problems });
        return;
      }
      setErrors({});
      create.mutate(result.data, { onSuccess: onClose });
    }
  }

  const failure = describeFailure(mutation.error, {
    DUPLICATE_CODE: 'code',
    DUPLICATE_BARCODE: 'barcode',
  });
  const fieldErrors = { ...toFormFields(failure.fields), ...errors };
  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">
        {item ? t('items.editTitle', { code: item.code }) : t('items.createTitle')}
      </h2>
      <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
        {failure.message && <ErrorAlert>{failure.message}</ErrorAlert>}
        <TextField
          label={t('items.code')}
          hint={t('items.codeHint')}
          name="code"
          autoComplete="off"
          spellCheck={false}
          autoFocus={!item}
          value={values.code}
          error={fieldErrors.code}
          readOnly={mutation.isPending}
          onChange={(event) => set('code')(event.target.value)}
        />
        <TextField
          label={t('items.barcode')}
          hint={t('items.barcodeHint')}
          name="barcode"
          autoComplete="off"
          spellCheck={false}
          value={values.barcode}
          error={fieldErrors.barcode}
          readOnly={mutation.isPending}
          onChange={(event) => set('barcode')(event.target.value)}
        />
        <TextField
          label={t('items.name')}
          hint={t('items.nameHint')}
          name="name"
          autoComplete="off"
          autoFocus={!!item}
          value={values.name}
          error={fieldErrors.name}
          readOnly={mutation.isPending}
          onChange={(event) => set('name')(event.target.value)}
        />
        <SelectField
          label={t('items.category')}
          name="categoryId"
          value={values.categoryId}
          error={fieldErrors.categoryId}
          disabled={mutation.isPending}
          onChange={(event) => set('categoryId')(event.target.value)}
        >
          <option value="">{t('items.noCategory')}</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={String(category.id)}>
              {category.name}
            </option>
          ))}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('items.mrp')}
            name="mrp"
            inputMode="decimal"
            autoComplete="off"
            value={values.mrp}
            error={fieldErrors.mrp}
            readOnly={mutation.isPending}
            onChange={(event) => set('mrp')(event.target.value)}
          />
          <TextField
            label={t('items.sellingPrice')}
            hint={t('items.sellingPriceHint')}
            name="sellingPrice"
            inputMode="decimal"
            autoComplete="off"
            value={values.sellingPrice}
            error={fieldErrors.sellingPrice}
            readOnly={mutation.isPending}
            onChange={(event) => set('sellingPrice')(event.target.value)}
          />
        </div>
        <TextField
          label={t('items.reorderLevel')}
          hint={t('items.reorderHint')}
          name="reorderLevel"
          inputMode="numeric"
          autoComplete="off"
          className="sm:max-w-40"
          value={values.reorderLevel}
          error={fieldErrors.reorderLevel}
          readOnly={mutation.isPending}
          onChange={(event) => set('reorderLevel')(event.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            {mutation.isPending
              ? item
                ? t('common.saving')
                : t('items.creating')
              : item
                ? t('common.save')
                : t('items.create')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
