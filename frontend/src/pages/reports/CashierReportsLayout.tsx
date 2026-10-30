import { NavLink, Outlet } from 'react-router-dom';
import { t } from '../../i18n/t';

const pill =
  'inline-flex h-11 items-center rounded-md px-4 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

const SECTIONS = [
  { path: '/reports', label: 'reports.myDay', end: true },
  { path: '/reports/stock', label: 'reports.stock', end: false },
  { path: '/reports/low-stock', label: 'reports.lowStock', end: false },
] as const;

/** Frame for a cashier's reports (D-22): their own day-end, and their branch's stock and low stock. */
export function CashierReportsLayout() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `${pill} ${
      isActive
        ? 'bg-blue-700 text-white'
        : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100'
    }`;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('nav.reportSections')} className="print:hidden">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((section) => (
            <li key={section.path}>
              <NavLink to={section.path} end={section.end} className={link}>
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
