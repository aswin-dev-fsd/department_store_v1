import type { Page } from '@ds/shared';
import { pageInfo } from '../admin/paging';
import { t } from '../i18n/t';
import { Button } from './ui';

interface PagerProps {
  page: Page<unknown>;
  onOffsetChange: (offset: number) => void;
  /** The next page is loading. */
  busy?: boolean;
}

/** "Showing 21–40 of 53" with Previous and Next. Shows nothing when everything fits on one page. */
export function Pager({ page, onOffsetChange, busy = false }: PagerProps) {
  const info = pageInfo(page);
  if (info.prevOffset === null && info.nextOffset === null) return null;

  return (
    <nav
      aria-label={t('common.pager')}
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-slate-700">
        {t('common.range', { from: info.from, to: info.to, total: info.total })}
      </p>
      <div className="flex gap-3">
        <Button
          variant="secondary"
          disabled={busy || info.prevOffset === null}
          onClick={() => info.prevOffset !== null && onOffsetChange(info.prevOffset)}
        >
          {t('common.previous')}
        </Button>
        <Button
          variant="secondary"
          disabled={busy || info.nextOffset === null}
          onClick={() => info.nextOffset !== null && onOffsetChange(info.nextOffset)}
        >
          {t('common.next')}
        </Button>
      </div>
    </nav>
  );
}
