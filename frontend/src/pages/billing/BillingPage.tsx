import { formatPaise } from '@ds/shared';
import { useEffect, useRef } from 'react';
import { useMe } from '../../auth/queries';
import { ItemPicker } from '../../components/ItemPicker';
import { Card } from '../../components/ui';
import { t } from '../../i18n/t';
import { BillLinesTable } from './BillLinesTable';
import { useBillDraft } from './useBillDraft';

/**
 * The billing counter (overview §4.6, §7.3): the cursor starts in the scan/search box and goes
 * back there after every item; the lines and the running total are always on screen. Payment and
 * saving come in Task 5.8.
 */
export function BillingPage() {
  const me = useMe().data;
  const branch = me?.branches.find((candidate) => candidate.id === me.activeBranchId);
  const bill = useBillDraft();
  const pickerRef = useRef<HTMLInputElement>(null);
  const totals = bill.summary.totals;

  useEffect(() => {
    pickerRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header>
          <h1 className="text-xl font-semibold">{t('billing.title')}</h1>
          {branch && (
            <p className="text-slate-700">
              {t('billing.branchLine', { branch: `${branch.code} — ${branch.name}` })}
            </p>
          )}
        </header>
        <Card>
          <ItemPicker
            inputRef={pickerRef}
            label={t('billing.pickerLabel')}
            onPick={(item) => {
              bill.add(item);
              pickerRef.current?.focus();
            }}
          />
        </Card>
        <Card>
          <BillLinesTable
            lines={bill.draft.lines}
            summaries={bill.summary.lines}
            onQuantity={bill.setQuantity}
            onDiscount={bill.setDiscount}
            onRemove={(key) => {
              bill.remove(key);
              pickerRef.current?.focus();
            }}
          />
        </Card>
      </div>

      <aside
        aria-label={t('billing.totalsLabel')}
        className="lg:sticky lg:top-4 lg:w-80"
      >
        <Card>
          <dl className="flex flex-col gap-2">
            <div className="flex justify-between">
              <dt>{t('billing.subtotal')}</dt>
              <dd>{formatPaise(totals?.subtotalPaise ?? 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('billing.discount')}</dt>
              <dd>−{formatPaise(totals?.discountPaise ?? 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t('billing.roundOff')}</dt>
              <dd>
                {(totals?.roundOffPaise ?? 0) >= 0 ? '+' : '−'}
                {formatPaise(Math.abs(totals?.roundOffPaise ?? 0))}
              </dd>
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-300 pt-2 text-2xl font-semibold">
              <dt>{t('billing.total')}</dt>
              <dd aria-live="polite">{formatPaise(totals?.totalPaise ?? 0)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-slate-600">
            {t('billing.lineCount', { count: bill.draft.lines.length })}
          </p>
        </Card>
      </aside>
    </div>
  );
}
