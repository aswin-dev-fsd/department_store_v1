import type { StockMovement } from '@ds/shared';
import { useState } from 'react';
import { Pager } from '../../components/Pager';
import { QueryProblem } from '../../components/QueryProblem';
import { t } from '../../i18n/t';
import { formatDateTime } from '../../lib/dates';
import { signedQuantity } from '../../stock/display';
import { useMovements } from '../../stock/queries';

/** A movement's reason and note as one line, like "Damage — Broken in the store room". */
function noteOf(movement: StockMovement): string {
  const parts: string[] = [];
  if (movement.reason !== null) parts.push(t(`stock.reason.${movement.reason}`));
  if (movement.note !== null && movement.note !== '') parts.push(movement.note);
  return parts.join(' — ');
}

const head = 'px-2 py-2 font-medium';

interface MovementsPanelProps {
  itemId: number;
  /** The branch an Admin chose; null for a cashier, who reads the branch they work in. */
  branchId: number | null;
}

/** One item's movement history, newest first: what moved, the balance after it, who and when. */
export function MovementsPanel({ itemId, branchId }: MovementsPanelProps) {
  const [offset, setOffset] = useState(0);
  const movements = useMovements(itemId, branchId, offset);

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <h3 className="mb-3 text-base font-semibold">{t('stock.historyTitle')}</h3>
      {movements.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : movements.isError && !movements.data ? (
        <QueryProblem error={movements.error} onRetry={() => void movements.refetch()} />
      ) : (
        <>
          {movements.data.items.length === 0 ? (
            <p className="text-slate-700">{t('stock.historyEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                <caption className="sr-only">{t('stock.historyTitle')}</caption>
                <thead>
                  <tr className="border-b border-slate-300 text-slate-700">
                    <th scope="col" className={head}>
                      {t('stock.col.when')}
                    </th>
                    <th scope="col" className={head}>
                      {t('stock.col.what')}
                    </th>
                    <th scope="col" className={`${head} text-right`}>
                      {t('stock.col.change')}
                    </th>
                    <th scope="col" className={`${head} text-right`}>
                      {t('stock.col.balance')}
                    </th>
                    <th scope="col" className={head}>
                      {t('stock.col.note')}
                    </th>
                    <th scope="col" className={head}>
                      {t('stock.col.by')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {movements.data.items.map((movement) => (
                    <tr key={movement.id} className="border-b border-slate-200 align-top">
                      <td className="px-2 py-2">{formatDateTime(movement.createdAt)}</td>
                      <td className="px-2 py-2">{t(`stock.type.${movement.type}`)}</td>
                      <td
                        className={`px-2 py-2 text-right font-semibold ${
                          movement.quantity < 0 ? 'text-red-800' : 'text-green-800'
                        }`}
                      >
                        {signedQuantity(movement.quantity)}
                      </td>
                      <td className="px-2 py-2 text-right">{movement.balanceAfter}</td>
                      <td className="px-2 py-2">{noteOf(movement)}</td>
                      <td className="px-2 py-2">{movement.createdBy.fullName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager
            page={movements.data}
            busy={movements.isPlaceholderData}
            onOffsetChange={setOffset}
          />
        </>
      )}
    </div>
  );
}
