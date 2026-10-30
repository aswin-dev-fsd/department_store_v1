import type { Permission } from '@ds/shared';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useLogout } from '../auth/mutations';
import { useMe } from '../auth/queries';
import type { MessageKey } from '../i18n/en';
import { t } from '../i18n/t';
import { Button, ErrorAlert } from './ui';

interface NavItem {
  to: string;
  label: MessageKey;
  permission: Permission;
}

// Which links a person sees follows their permissions, never their role name
const NAV_ITEMS: readonly NavItem[] = [
  { to: '/admin', label: 'nav.admin', permission: 'admin:branches' },
  { to: '/billing', label: 'nav.billing', permission: 'bill:create' },
  { to: '/bills', label: 'nav.bills', permission: 'bill:read' },
  { to: '/purchases', label: 'nav.purchases', permission: 'purchase:write' },
  { to: '/catalog', label: 'nav.catalog', permission: 'item:write' },
  { to: '/stock', label: 'nav.stock', permission: 'stock:read' },
];

const linkStyle = 'rounded-md px-2 py-2 underline-offset-4 hover:underline';

/** Header (who, where, log out) and navigation around every logged-in screen. */
export function AppShell() {
  const me = useMe().data;
  const logout = useLogout();
  if (!me) return null;

  // While a password change or branch choice is due, the only way out is to do it (or log out)
  const setupPending = me.user.mustChangePassword || me.needsBranchSelection;
  const links = setupPending
    ? []
    : NAV_ITEMS.filter((item) => me.permissions.includes(item.permission));
  const branch = me.branches.find((candidate) => candidate.id === me.activeBranchId);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
          <span className="text-lg font-semibold">{t('app.name')}</span>
          {links.length > 0 && (
            <nav aria-label={t('nav.main')} className="flex gap-1">
              {links.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `${linkStyle} ${isActive ? 'font-semibold text-blue-800 underline' : 'text-slate-800'}`
                  }
                >
                  {t(item.label)}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 text-sm">
            <span>
              {me.user.fullName} · {t(`role.${me.user.role}`)}
            </span>
            {branch && (
              <span>{t('shell.branch', { branch: `${branch.code} — ${branch.name}` })}</span>
            )}
            {!setupPending && me.branches.length > 1 && (
              <Link to="/select-branch" className={`${linkStyle} text-blue-800`}>
                {t('shell.changeBranch')}
              </Link>
            )}
            {!me.user.mustChangePassword && (
              <Link to="/change-password" className={`${linkStyle} text-blue-800`}>
                {t('shell.changePassword')}
              </Link>
            )}
            <Button variant="secondary" disabled={logout.isPending} onClick={() => logout.mutate()}>
              {logout.isPending ? t('shell.loggingOut') : t('shell.logout')}
            </Button>
          </div>
        </div>
        {logout.isError && (
          <div className="mx-auto max-w-6xl px-4 pb-2">
            <ErrorAlert>{errorMessage(logout.error)}</ErrorAlert>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
