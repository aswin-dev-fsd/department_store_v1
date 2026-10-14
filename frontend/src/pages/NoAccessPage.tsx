import { Link } from 'react-router-dom';
import { Card } from '../components/ui';
import { t } from '../i18n/t';

/** Shown when the logged-in person's role doesn't allow the page they opened. */
export function NoAccessPage() {
  return (
    <Card className="mx-auto w-full max-w-md">
      <h1 className="mb-2 text-xl font-semibold">{t('noAccess.title')}</h1>
      <p className="mb-4 text-slate-700">{t('noAccess.body')}</p>
      <Link to="/" className="text-blue-800 underline underline-offset-4">
        {t('common.backToStart')}
      </Link>
    </Card>
  );
}
