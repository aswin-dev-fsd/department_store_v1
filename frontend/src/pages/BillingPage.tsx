import { useMe } from '../auth/queries';
import { Card } from '../components/ui';
import { t } from '../i18n/t';

/** Placeholder for the billing counter, which is built in Phase 5. */
export function BillingPage() {
  const me = useMe().data;
  const branch = me?.branches.find((candidate) => candidate.id === me.activeBranchId);

  return (
    <Card>
      <h1 className="mb-2 text-xl font-semibold">{t('billing.title')}</h1>
      <p className="text-slate-700">
        {t('billing.placeholder', { branch: branch ? `${branch.code} — ${branch.name}` : '' })}
      </p>
    </Card>
  );
}
