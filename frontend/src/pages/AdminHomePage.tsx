import { Card } from '../components/ui';
import { t } from '../i18n/t';

/** The Admin's landing page. Branches, users and settings screens are added in Task 2.11. */
export function AdminHomePage() {
  return (
    <Card>
      <h1 className="mb-2 text-xl font-semibold">{t('adminHome.title')}</h1>
      <p className="text-slate-700">{t('adminHome.intro')}</p>
    </Card>
  );
}
