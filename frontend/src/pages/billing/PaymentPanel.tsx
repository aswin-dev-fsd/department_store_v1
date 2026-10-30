import { formatPaise, PAYMENT_MODES, type PaymentMode } from '@ds/shared';
import type { Ref } from 'react';
import { Button, ErrorAlert, TextField } from '../../components/ui';
import { t } from '../../i18n/t';
import { restInCash, type PaymentDraft, type PaymentSummary } from './payments';

interface PaymentPanelProps {
  draft: PaymentDraft;
  summary: PaymentSummary;
  totalPaise: number;
  onChange: (draft: PaymentDraft) => void;
  /** The server's refusal of the payments (PAYMENT_MISMATCH), shown in the panel. */
  problem: string | null;
  /** Wraps the panel, so F8 can put the cursor in its first field. */
  panelRef?: Ref<HTMLFieldSetElement>;
}

const modeLabel = {
  cash: 'billing.pay.cash',
  upi: 'billing.pay.upi',
  card: 'billing.pay.card',
} as const satisfies Record<PaymentMode, string>;

/**
 * How the bill is paid (overview §6.5): an amount per mode, split as the customer likes, with a
 * "rest in cash" quick fill and what is still to pay. The cash handed over only works out the
 * change; only the bill amount is recorded.
 */
export function PaymentPanel({
  draft,
  summary,
  totalPaise,
  onChange,
  problem,
  panelRef,
}: PaymentPanelProps) {
  const remaining = summary.remainingPaise;

  return (
    <fieldset ref={panelRef} className="flex flex-col gap-3">
      <legend className="mb-2 font-semibold">{t('billing.pay.title')}</legend>
      {PAYMENT_MODES.map((mode) => (
        <TextField
          key={mode}
          label={t(modeLabel[mode])}
          error={summary.problems[mode]}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={draft[mode]}
          onChange={(event) => onChange({ ...draft, [mode]: event.target.value })}
        />
      ))}
      <Button
        variant="secondary"
        disabled={totalPaise <= 0}
        onClick={() => onChange(restInCash(draft, totalPaise))}
      >
        {t('billing.pay.restInCash')}
      </Button>

      {totalPaise > 0 && (
        <p
          aria-live="polite"
          className={`flex justify-between font-medium ${remaining === 0 ? 'text-green-800' : 'text-amber-800'}`}
        >
          <span>
            {remaining > 0
              ? t('billing.pay.remaining')
              : remaining < 0
                ? t('billing.pay.over')
                : t('billing.pay.balanced')}
          </span>
          {remaining !== 0 && <span>{formatPaise(Math.abs(remaining))}</span>}
        </p>
      )}

      <TextField
        label={t('billing.pay.tendered')}
        hint={t('billing.pay.tenderedHint')}
        error={summary.tenderedProblem ?? undefined}
        inputMode="decimal"
        autoComplete="off"
        value={draft.tendered}
        onChange={(event) => onChange({ ...draft, tendered: event.target.value })}
      />
      {summary.changePaise !== null && (
        <p aria-live="polite" className="flex justify-between text-lg font-semibold">
          <span>{t('billing.pay.change')}</span>
          <span>{formatPaise(summary.changePaise)}</span>
        </p>
      )}

      {problem && <ErrorAlert>{problem}</ErrorAlert>}
    </fieldset>
  );
}
