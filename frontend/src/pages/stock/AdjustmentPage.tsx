import { ADJUSTMENT_REASONS, type Item, type StockAdjustment } from '@ds/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { ItemPicker } from '../../components/ItemPicker';
import { Button, Card, ErrorAlert, Notice, SelectField, TextField } from '../../components/ui';
import { describeFailure } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';
import {
  checkAdjustment,
  EMPTY_ADJUSTMENT,
  type AdjustmentForm,
  type Direction,
} from '../../stock/adjustment';
import { signedQuantity } from '../../stock/display';
import { useCreateAdjustment } from '../../stock/mutations';
import { MovementsPanel } from './MovementsPanel';

/** Packs available, from an INSUFFICIENT_STOCK refusal; null for any other failure. */
function availableFrom(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'INSUFFICIENT_STOCK') return null;
  const [first] = Array.isArray(error.details) ? (error.details as { available?: unknown }[]) : [];
  return typeof first?.available === 'number' ? first.available : null;
}

const directionLabel: Record<Direction, 'adjust.remove' | 'adjust.add'> = {
  remove: 'adjust.remove',
  add: 'adjust.add',
};

/**
 * Stock → Adjust stock (D-20; overview §7.6): choose the item, add or take away packs with a
 * reason ("other" needs a note), check "stock X → Y", save. Afterwards the item's movement
 * history is one click away.
 */
export function AdjustmentPage() {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [form, setForm] = useState<AdjustmentForm>(EMPTY_ADJUSTMENT);
  const [reviewing, setReviewing] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState<StockAdjustment | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const adjust = useCreateAdjustment();

  useEffect(() => {
    pickerRef.current?.focus();
  }, []);

  const check = item ? checkAdjustment(form, item.id, item.stock) : null;
  const failure = describeFailure(adjust.error);
  const available = availableFrom(adjust.error);
  const errors = { ...(showErrors ? check?.errors : {}), ...failure.fields };

  function change(next: Partial<AdjustmentForm>) {
    setForm({ ...form, ...next });
    setReviewing(false);
    adjust.reset();
  }

  function startAgain() {
    setItem(null);
    setForm(EMPTY_ADJUSTMENT);
    setReviewing(false);
    setShowErrors(false);
    setSaved(null);
    setShowHistory(false);
    adjust.reset();
    setTimeout(() => pickerRef.current?.focus(), 0);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('adjust.title')}</h1>
          <p className="text-slate-700">{t('adjust.intro')}</p>
        </div>
        <Link to="/stock" className="py-2 text-blue-800 underline-offset-4 hover:underline">
          {t('adjust.backToStock')}
        </Link>
      </header>

      {saved && item ? (
        <Card className="flex flex-col gap-4">
          <Notice>
            {t('adjust.saved', {
              name: item.name,
              change: signedQuantity(saved.quantity),
              before: saved.balanceBefore,
              after: saved.balanceAfter,
            })}
          </Notice>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              aria-expanded={showHistory}
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? t('stock.hideHistory') : t('adjust.showHistory')}
            </Button>
            <Button onClick={startAgain}>{t('adjust.another')}</Button>
          </div>
          {showHistory && <MovementsPanel itemId={saved.itemId} branchId={null} />}
        </Card>
      ) : (
        <>
          <Card>
            {item ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{item.name}</h2>
                  <p className="font-mono text-sm text-slate-600">{item.code}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold">{item.stock}</p>
                  <p className="text-sm text-slate-600">{t('stock.quantity')}</p>
                </div>
                <div className="w-full">
                  <Button variant="secondary" onClick={startAgain}>
                    {t('adjust.chooseOther')}
                  </Button>
                </div>
              </div>
            ) : (
              <ItemPicker
                inputRef={pickerRef}
                label={t('adjust.pickerLabel')}
                onPick={(picked) => {
                  setItem(picked);
                  setForm(EMPTY_ADJUSTMENT);
                  setShowErrors(false);
                  adjust.reset();
                }}
              />
            )}
          </Card>

          {item && check && (
            <Card className="flex flex-col gap-4">
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-slate-800">
                  {t('adjust.direction')}
                </legend>
                <div className="flex gap-3">
                  {(['remove', 'add'] as const).map((direction) => (
                    <Button
                      key={direction}
                      variant={form.direction === direction ? 'primary' : 'secondary'}
                      aria-pressed={form.direction === direction}
                      onClick={() => change({ direction })}
                    >
                      {t(directionLabel[direction])}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <TextField
                label={t('adjust.quantity')}
                inputMode="numeric"
                autoComplete="off"
                value={form.quantity}
                error={errors.quantity}
                onChange={(event) => change({ quantity: event.target.value })}
              />
              <SelectField
                label={t('adjust.reason')}
                value={form.reason}
                error={errors.reason}
                onChange={(event) =>
                  change({ reason: event.target.value as AdjustmentForm['reason'] })
                }
              >
                <option value="">{t('adjust.chooseReason')}</option>
                {ADJUSTMENT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {t(`stock.reason.${reason}`)}
                  </option>
                ))}
              </SelectField>
              {form.reason === 'other' && (
                <TextField
                  label={t('adjust.note')}
                  maxLength={200}
                  autoComplete="off"
                  value={form.note}
                  error={errors.note}
                  onChange={(event) => change({ note: event.target.value })}
                />
              )}

              {!reviewing ? (
                <div>
                  <Button
                    onClick={() => {
                      setShowErrors(true);
                      if (check.input) setReviewing(true);
                    }}
                  >
                    {t('adjust.review')}
                  </Button>
                </div>
              ) : (
                <div
                  role="group"
                  aria-labelledby="adjust-confirm"
                  className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4"
                >
                  <p id="adjust-confirm" className="text-amber-950">
                    {t('adjust.confirm', {
                      name: item.name,
                      before: item.stock,
                      after: check.after ?? item.stock,
                    })}
                  </p>
                  {available !== null && (
                    <ErrorAlert>{t('adjust.belowZero', { count: available })}</ErrorAlert>
                  )}
                  {available === null && failure.message && (
                    <ErrorAlert>{failure.message}</ErrorAlert>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      disabled={adjust.isPending || !check.input}
                      onClick={() =>
                        check.input &&
                        adjust.mutate(check.input, { onSuccess: (result) => setSaved(result) })
                      }
                    >
                      {adjust.isPending ? t('adjust.saving') : t('adjust.save')}
                    </Button>
                    <Button variant="secondary" onClick={() => setReviewing(false)}>
                      {t('adjust.edit')}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
