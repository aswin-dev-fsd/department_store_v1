import { useEffect, useState } from 'react';
import { t } from '../i18n/t';

/** A free-tier server can take most of a minute to wake; say so after a few seconds. */
const SLOW_AFTER_MS = 6000;

/** Full-page "loading" state. */
export function LoadingScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 p-6 text-slate-700">
      <p role="status">{t('common.loading')}</p>
      {slow && <p className="text-sm text-slate-600">{t('common.stillConnecting')}</p>}
    </main>
  );
}
