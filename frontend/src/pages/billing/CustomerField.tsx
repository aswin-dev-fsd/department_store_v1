import { normalisePhone } from '@ds/shared';
import { errorMessage } from '../../api/errors';
import { useCustomerLookup } from '../../bills/queries';
import { TextField } from '../../components/ui';
import { t } from '../../i18n/t';

interface CustomerFieldProps {
  phone: string;
  name: string;
  onPhone: (phone: string) => void;
  onName: (name: string) => void;
}

/**
 * The optional customer (D-18): a mobile number, looked up as soon as it is a whole one. A known
 * customer's name is shown; for a new customer, or one with no name on record, a name field
 * appears. The customer is created or filled in by the server when the bill is saved.
 */
export function CustomerField({ phone, name, onPhone, onName }: CustomerFieldProps) {
  const normalised = normalisePhone(phone);
  const lookup = useCustomerLookup(normalised);
  const typed = phone.trim() !== '';
  const known = lookup.data;
  const askName = normalised !== null && !lookup.isPending && !known?.name;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 font-semibold">{t('billing.customer.title')}</legend>
      <TextField
        label={t('billing.customer.phone')}
        hint={typed ? undefined : t('billing.customer.phoneHint')}
        error={typed && normalised === null ? t('billing.customer.phoneFormat') : undefined}
        inputMode="tel"
        autoComplete="off"
        value={phone}
        onChange={(event) => onPhone(event.target.value)}
      />
      {normalised !== null && (
        <p role="status" className="text-sm text-slate-700">
          {lookup.isPending
            ? t('billing.customer.looking')
            : lookup.isError
              ? errorMessage(lookup.error)
              : known
                ? known.name
                  ? t('billing.customer.known', { name: known.name })
                  : t('billing.customer.knownNoName')
                : t('billing.customer.new')}
        </p>
      )}
      {askName && (
        <TextField
          label={t('billing.customer.name')}
          maxLength={100}
          autoComplete="off"
          value={name}
          onChange={(event) => onName(event.target.value)}
        />
      )}
    </fieldset>
  );
}
