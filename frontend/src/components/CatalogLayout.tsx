import { NavLink, Outlet } from 'react-router-dom';
import { useMe } from '../auth/queries';
import { visibleCatalogSections } from '../catalog/sections';
import { t } from '../i18n/t';
import { NoAccessPage } from '../pages/NoAccessPage';

const pill =
  'inline-flex h-11 items-center rounded-md px-4 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

/**
 * Frame for the catalog: a row of links to the sections the person may open (items, categories,
 * vendors), then the section itself. Opens for anyone holding at least one catalog permission;
 * each section also checks its own (App.tsx), and the API checks every call.
 */
export function CatalogLayout() {
  const me = useMe().data;
  if (!me) return null;
  const sections = visibleCatalogSections(me.permissions);
  if (sections.length === 0) return <NoAccessPage />;

  const link = ({ isActive }: { isActive: boolean }) =>
    `${pill} ${
      isActive
        ? 'bg-blue-700 text-white'
        : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100'
    }`;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('nav.catalogSections')}>
        <ul className="flex flex-wrap gap-2">
          {sections.map((section) => (
            <li key={section.slug}>
              <NavLink to={section.path} className={link}>
                {t(section.label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
