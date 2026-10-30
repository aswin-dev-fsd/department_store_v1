import { formatPaise, normalisePhone, type CreateBillInput } from '@ds/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { useMe } from '../../auth/queries';
import { useCreateBill } from '../../bills/mutations';
import { ItemPicker } from '../../components/ItemPicker';
import { Button, Card, ErrorAlert, Notice } from '../../components/ui';
import { t } from '../../i18n/t';
import { printReceipt } from '../../print/printReceipt';
import { BillLinesTable } from './BillLinesTable';
import { CustomerField } from './CustomerField';
import { PaymentPanel } from './PaymentPanel';
import { EMPTY_PAYMENTS, summarizePayments } from './payments';
import { useBillDraft, type DraftLine } from './useBillDraft';

/** Item id → packs available, read from an INSUFFICIENT_STOCK refusal's details. */
function shortagesOf(details: unknown): Map<number, number> {
  const shortages = new Map<number, number>();
  if (!Array.isArray(details)) return shortages;
  for (const entry of details as { itemId?: unknown; available?: unknown }[]) {
    if (typeof entry?.itemId === 'number' && typeof entry.available === 'number') {
      shortages.set(entry.itemId, entry.available);
    }
  }
  return shortages;
}

/**
 * The billing counter (overview §4.6, §6.5, §7.3): the cursor starts in the scan/search box and
 * goes back there after every item; the lines and the running total are always on screen. The
 * payment panel takes the money, split as the customer likes; Save is enabled only when the
 * payments equal the total; after a save the receipt prints (Task 5.9) and the screen is empty,
 * ready for the next customer.
 * F2 = search, F8 = payment, F9 = save.
 */
export function BillingPage() {
  const me = useMe().data;
  const branch = me?.branches.find((candidate) => candidate.id === me.activeBranchId);
  const bill = useBillDraft();
  const createBill = useCreateBill();
  const pickerRef = useRef<HTMLInputElement>(null);
  const paymentRef = useRef<HTMLFieldSetElement>(null);
  const [payments, setPayments] = useState(EMPTY_PAYMENTS);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<{ billNo: string; changePaise: number | null } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [paymentProblem, setPaymentProblem] = useState<string | null>(null);
  // The short lines of the last refused save; shown only until the lines change
  const [shortage, setShortage] = useState<{
    lines: DraftLine[];
    available: Map<number, number>;
  } | null>(null);

  const totals = bill.summary.totals;
  const totalPaise = bill.summary.ready ? (totals?.totalPaise ?? 0) : 0;
  const paymentSummary = useMemo(
    () => summarizePayments(payments, totalPaise),
    [payments, totalPaise],
  );
  const phoneTyped = phone.trim() !== '';
  const customerPhone = normalisePhone(phone);
  const canSave =
    bill.summary.ready &&
    paymentSummary.ready &&
    (!phoneTyped || customerPhone !== null) &&
    !createBill.isPending;
  const shortages = shortage?.lines === bill.draft.lines ? shortage.available : undefined;

  const save = () => {
    if (!canSave) return;
    setSaved(null);
    setSaveError(null);
    setPrintError(null);
    setPaymentProblem(null);
    setShortage(null);
    const lines = bill.draft.lines;
    const changePaise = paymentSummary.changePaise;
    const input: CreateBillInput = {
      lines: bill.summary.input,
      payments: paymentSummary.input,
      ...(customerPhone !== null && {
        customer: { phone: customerPhone, ...(name.trim() !== '' && { name: name.trim() }) },
      }),
    };
    createBill.mutate(input, {
      onSuccess: (created) => {
        setSaved({ billNo: created.billNo, changePaise: changePaise || null });
        bill.reset();
        setPayments(EMPTY_PAYMENTS);
        setPhone('');
        setName('');
        pickerRef.current?.focus();
        // The bill is saved whatever happens to the print; the cursor comes back after it
        printReceipt(created.id)
          .catch((error: unknown) =>
            setPrintError(t('billing.printFailed', { reason: errorMessage(error) })),
          )
          .finally(() => pickerRef.current?.focus());
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK') {
          setShortage({ lines, available: shortagesOf(error.details) });
        } else if (error instanceof ApiError && error.code === 'PAYMENT_MISMATCH') {
          setPaymentProblem(errorMessage(error));
        } else {
          setSaveError(errorMessage(error));
        }
      },
    });
  };

  // The counter's keys; the latest save is read through a ref, so the listener is added once
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        pickerRef.current?.focus();
      } else if (event.key === 'F8') {
        event.preventDefault();
        paymentRef.current?.querySelector('input')?.focus();
      } else if (event.key === 'F9') {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          <p className="text-sm text-slate-600">{t('billing.shortcuts')}</p>
        </header>
        {saved && (
          <Notice>
            {saved.changePaise === null
              ? t('billing.saved', { billNo: saved.billNo })
              : t('billing.savedChange', {
                  billNo: saved.billNo,
                  change: formatPaise(saved.changePaise),
                })}
          </Notice>
        )}
        {printError && <ErrorAlert>{printError}</ErrorAlert>}
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
          {shortages && <ErrorAlert>{t('billing.short')}</ErrorAlert>}
          <BillLinesTable
            lines={bill.draft.lines}
            summaries={bill.summary.lines}
            shortages={shortages}
            onQuantity={bill.setQuantity}
            onDiscount={bill.setDiscount}
            onRemove={(key) => {
              bill.remove(key);
              pickerRef.current?.focus();
            }}
          />
        </Card>
        <Card>
          <CustomerField phone={phone} name={name} onPhone={setPhone} onName={setName} />
        </Card>
      </div>

      <aside
        aria-label={t('billing.totalsLabel')}
        className="flex flex-col gap-4 lg:sticky lg:top-4 lg:w-80"
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
        <Card>
          <PaymentPanel
            panelRef={paymentRef}
            draft={payments}
            summary={paymentSummary}
            totalPaise={totalPaise}
            onChange={setPayments}
            problem={paymentProblem}
          />
          <div className="mt-4 flex flex-col gap-2">
            {saveError && <ErrorAlert>{saveError}</ErrorAlert>}
            <Button disabled={!canSave} onClick={save}>
              {createBill.isPending ? t('billing.saving') : t('billing.save')}
            </Button>
            {!canSave && !createBill.isPending && (
              <p className="text-sm text-slate-600">{t('billing.saveHint')}</p>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}
