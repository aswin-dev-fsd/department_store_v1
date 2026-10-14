import { Link } from 'react-router-dom';
import { visibleSections } from '../admin/sections';
import { useMe } from '../auth/queries';
import { t } from '../i18n/t';

/** The Admin's landing page: a card for each section they may open. */
export function AdminHomePage() {
  const me = useMe().data;
  if (!me) return null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">{t('adminHome.title')}</h1>
        <p className="text-slate-700">{t('adminHome.intro')}</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleSections(me.permissions).map((section) => (
          <li key={section.slug}>
            <Link
              to={section.path}
              className="block h-full rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              <h2 className="text-lg font-semibold">{t(section.label)}</h2>
              <p className="mt-1 text-sm text-slate-700">{t(section.blurb)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
