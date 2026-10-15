import { createVendorSchema, updateVendorSchema, type Vendor } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { EMPTY_VENDOR_FORM, vendorToForm } from '../../catalog/forms';
import { useCreateVendor, useUpdateVendor } from '../../catalog/mutations';
import { Button, Card, ErrorAlert, TextField } from '../../components/ui';
import { describeFailure, validateForm, type FieldErrors } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';

interface VendorFormProps {
  /** The vendor to edit; leave out to add a new one. */
  vendor?: Vendor;
  /** Runs after a successful save, and when the person cancels. */
  onClose: () => void;
}

/** Add a vendor, or edit the one given. */
export function VendorForm({ vendor, onClose }: VendorFormProps) {
  const create = useCreateVendor();
  const update = useUpdateVendor();
  const mutation = vendor ? update : create;
  const [values, setValues] = useState(vendor ? vendorToForm(vendor) : EMPTY_VENDOR_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (mutation.isPending) return;

    if (vendor) {
      const result = validateForm(updateVendorSchema, values);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
      update.mutate({ id: vendor.id, changes: result.data }, { onSuccess: onClose });
    } else {
      const result = validateForm(createVendorSchema, values);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
      create.mutate(result.data, { onSuccess: onClose });
    }
  }

  const failure = describeFailure(mutation.error);
  const fieldErrors = { ...failure.fields, ...errors };
  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">
        {vendor ? t('vendors.editTitle', { name: vendor.name }) : t('vendors.createTitle')}
      </h2>
      <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
        {failure.message && <ErrorAlert>{failure.message}</ErrorAlert>}
        <TextField
          label={t('vendors.name')}
          name="name"
          autoComplete="off"
          autoFocus
          value={values.name}
          error={fieldErrors.name}
          readOnly={mutation.isPending}
          onChange={(event) => set('name')(event.target.value)}
        />
        <TextField
          label={t('vendors.phone')}
          name="phone"
          type="tel"
          autoComplete="off"
          value={values.phone}
          error={fieldErrors.phone}
          readOnly={mutation.isPending}
          onChange={(event) => set('phone')(event.target.value)}
        />
        <TextField
          label={t('vendors.address')}
          name="address"
          autoComplete="off"
          value={values.address}
          error={fieldErrors.address}
          readOnly={mutation.isPending}
          onChange={(event) => set('address')(event.target.value)}
        />
        <TextField
          label={t('vendors.gstin')}
          hint={t('vendors.gstinHint')}
          name="gstin"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="uppercase sm:max-w-80"
          value={values.gstin}
          error={fieldErrors.gstin}
          readOnly={mutation.isPending}
          onChange={(event) => set('gstin')(event.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            {mutation.isPending
              ? vendor
                ? t('common.saving')
                : t('vendors.creating')
              : vendor
                ? t('common.save')
                : t('vendors.create')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
