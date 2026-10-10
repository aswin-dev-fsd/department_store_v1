import type { HealthStatus } from '@ds/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { t } from '../i18n/t';

/** Shows whether the API and database are reachable — the Phase 1 smoke test page. */
export function StatusPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthStatus>('/health'),
    refetchInterval: 30_000,
  });

  const apiStatus = health.isPending
    ? t('status.checking')
    : health.isError
      ? t('status.unreachable')
      : t('status.ok');
  const databaseStatus = health.data ? t(`status.${health.data.database}`) : '—';

  // Each line is coloured by its own state: the API can be up while the database is down
  const apiColour = health.isPending
    ? 'text-slate-500'
    : health.isError
      ? 'text-red-700'
      : 'text-green-700';
  const databaseColour = !health.data
    ? 'text-slate-500'
    : health.data.database === 'ok'
      ? 'text-green-700'
      : 'text-red-700';

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
      <section className="mt-6 max-w-sm rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-medium">{t('status.title')}</h2>
        <p data-testid="api-status" className={apiColour}>
          {t('status.apiLine', { status: apiStatus })}
        </p>
        <p data-testid="database-status" className={databaseColour}>
          {t('status.databaseLine', { status: databaseStatus })}
        </p>
      </section>
    </main>
  );
}
