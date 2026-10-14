import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useMe } from '../auth/queries';
import { requiredRoute } from '../auth/routing';
import { t } from '../i18n/t';
import { LoadingScreen } from './LoadingScreen';
import { Button, ErrorAlert } from './ui';

/**
 * Wraps every screen that needs to know who is logged in. Waits for the answer, then sends
 * the visitor wherever `requiredRoute` says (login, password change, branch picker, home).
 */
export function AuthGate() {
  const me = useMe();
  const location = useLocation();

  // True once anyone has been logged in during this visit. The gate lives for the whole
  // visit, so this survives navigation; a reload starts afresh (a link arrival, below).
  const [sawSession, setSawSession] = useState(false);
  if (me.data && !sawSession) setSawSession(true);

  if (me.data === undefined) {
    if (!me.isError) return <LoadingScreen />;
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6">
        <ErrorAlert>{errorMessage(me.error)}</ErrorAlert>
        <Button onClick={() => void me.refetch()}>{t('common.retry')}</Button>
      </main>
    );
  }

  // Someone arriving on a link is sent back to it after login; someone who just logged out
  // (or lost their session) starts from a plain login page
  const redirect = requiredRoute(me.data, location, { rememberPath: !sawSession });
  if (redirect) return <Navigate to={redirect} replace />;
  return <Outlet />;
}
