import type { BillStatus } from '@ds/shared';
import { StatusBadge } from '../../components/StatusBadge';
import { t } from '../../i18n/t';

const TONE = { completed: 'green', cancelled: 'grey' } as const;

/** "Completed" or "Cancelled"; the word carries the meaning, the colour backs it up. */
export function BillStatusBadge({ status }: { status: BillStatus }) {
  return <StatusBadge tone={TONE[status]}>{t(`bills.status.${status}`)}</StatusBadge>;
}
