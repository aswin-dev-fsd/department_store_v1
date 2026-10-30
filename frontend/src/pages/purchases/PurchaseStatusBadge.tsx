import type { PurchaseStatus } from '@ds/shared';
import { StatusBadge } from '../../components/StatusBadge';
import { t } from '../../i18n/t';

const TONE = { draft: 'amber', posted: 'green', cancelled: 'grey' } as const;

/** "Draft", "Posted" or "Cancelled"; the word carries the meaning, the colour backs it up. */
export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  return <StatusBadge tone={TONE[status]}>{t(`purchases.status.${status}`)}</StatusBadge>;
}
