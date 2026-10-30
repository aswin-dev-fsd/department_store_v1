import { formatPaise } from '@ds/shared';
import { Button } from '../../components/ui';
import { t } from '../../i18n/t';
import type { DraftLine, LineSummary } from './useBillDraft';

interface BillLinesTableProps {
  lines: DraftLine[];
  /** Each line's total or problem, in the same order. */
  summaries: LineSummary[];
  onQuantity: (key: string, quantity: string) => void;
  onDiscount: (key: string, discount: string) => void;
  onRemove: (key: string) => void;
  /** Item id → packs available, from the server's INSUFFICIENT_STOCK refusal of the last save. */
  shortages?: ReadonlyMap<number, number> | undefined;
}

const cell = 'px-2 py-2 align-top';
const input =
  'h-11 w-24 rounded-md border bg-white px-2 text-right text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

/**
 * The bill's lines: item, price, editable quantity and discount (in rupees), line total, the stock
 * shown when the item was added with a warning when the quantity is above it, and Remove. A line
 * the server refused for short stock is marked with what is really available.
 */
export function BillLinesTable({
  lines,
  summaries,
  onQuantity,
  onDiscount,
  onRemove,
  shortages,
}: BillLinesTableProps) {
  if (lines.length === 0) {
    return <p className="py-6 text-center text-slate-600">{t('billing.empty')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <caption className="sr-only">{t('billing.linesCaption')}</caption>
        <thead>
          <tr className="border-b border-slate-300 text-sm text-slate-700">
            <th scope="col" className={cell}>
              {t('billing.col.item')}
            </th>
            <th scope="col" className={`${cell} text-right`}>
              {t('billing.col.price')}
            </th>
            <th scope="col" className={`${cell} text-right`}>
              {t('billing.col.quantity')}
            </th>
            <th scope="col" className={`${cell} text-right`}>
              {t('billing.col.discount')}
            </th>
            <th scope="col" className={`${cell} text-right`}>
              {t('billing.col.total')}
            </th>
            <th scope="col" className={cell}>
              <span className="sr-only">{t('billing.col.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const summary = summaries[index];
            const problemId = `${line.key}-problem`;
            const stockId = `${line.key}-stock`;
            const available = shortages?.get(line.itemId);
            return (
              <tr key={line.key} className="border-b border-slate-100">
                <td className={cell}>
                  <p className="font-medium">{line.name}</p>
                  <p className="text-sm text-slate-600">
                    {t('picker.codeLine', { code: line.code })} ·{' '}
                    <span id={stockId}>{t('billing.inStock', { count: line.stock })}</span>
                  </p>
                  {available !== undefined && (
                    <p className="text-sm font-semibold text-red-700">
                      {t('billing.available', { count: available })}
                    </p>
                  )}
                  {available === undefined && summary?.overStock && (
                    <p className="text-sm font-medium text-amber-800">
                      {t('billing.overStock', { count: line.stock })}
                    </p>
                  )}
                  {summary?.problem && (
                    <p id={problemId} className="text-sm text-red-700">
                      {summary.problem}
                    </p>
                  )}
                </td>
                <td className={`${cell} text-right whitespace-nowrap`}>
                  {formatPaise(line.unitPricePaise)}
                </td>
                <td className={`${cell} text-right`}>
                  <input
                    aria-label={t('billing.quantityFor', { name: line.name })}
                    aria-describedby={summary?.problem ? problemId : stockId}
                    aria-invalid={summary?.problem ? true : undefined}
                    inputMode="numeric"
                    autoComplete="off"
                    value={line.quantity}
                    onChange={(event) => onQuantity(line.key, event.target.value)}
                    className={`${input} ${summary?.problem ? 'border-red-600' : 'border-slate-400'}`}
                  />
                </td>
                <td className={`${cell} text-right`}>
                  <input
                    aria-label={t('billing.discountFor', { name: line.name })}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={line.discount}
                    onChange={(event) => onDiscount(line.key, event.target.value)}
                    className={`${input} border-slate-400`}
                  />
                </td>
                <td className={`${cell} text-right font-medium whitespace-nowrap`}>
                  {summary?.lineTotalPaise == null ? '—' : formatPaise(summary.lineTotalPaise)}
                </td>
                <td className={cell}>
                  <Button
                    variant="secondary"
                    aria-label={t('billing.removeNamed', { name: line.name })}
                    onClick={() => onRemove(line.key)}
                  >
                    {t('billing.remove')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
