import { formatPaise, type Bill, type PaymentMode } from '@ds/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { useMe } from '../../auth/queries';
import { useCancelBill } from '../../bills/mutations';
import { useBill } from '../../bills/queries';
import { QueryProblem } from '../../components/QueryProblem';
import { Button, Card, ErrorAlert, Notice, TextField } from '../../components/ui';
import { describeFailure } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';
import { formatDateTime } from '../../lib/dates';
import { printReceipt } from '../../print/printReceipt';
import { BillStatusBadge } from './BillStatusBadge';

const modeLabel = {
  cash: 'receipt.mode.cash',
  upi: 'receipt.mode.upi',
  card: 'receipt.mode.card',
} as const satisfies Record<PaymentMode, string>;

const cell = 'py-2 pr-3';

/** Cancel a completed bill: a reason, then a confirmation naming the bill and its total. */
function CancelBill({ bill }: { bill: Bill }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useCancelBill();
  const failure = describeFailure(cancel.error);
  const problem =
    cancel.error instanceof ApiError && cancel.error.code === 'DOCUMENT_LOCKED'
      ? t('bills.alreadyCancelled')
      : failure.message;

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t('bills.cancel')}
        </Button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby="bill-cancel-confirm"
      className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4"
    >
      <p id="bill-cancel-confirm" className="text-sm text-amber-950">
        {t('bills.cancelConfirm', { billNo: bill.billNo, total: formatPaise(bill.totalPaise) })}
      </p>
      <TextField
        label={t('bills.cancelReason')}
        name="reason"
        autoComplete="off"
        maxLength={200}
        autoFocus
        value={reason}
        error={failure.fields.reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {problem && <ErrorAlert>{problem}</ErrorAlert>}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="danger"
          disabled={cancel.isPending || reason.trim().length < 3}
          onClick={() => cancel.mutate({ id: bill.id, input: { reason } })}
        >
          {cancel.isPending ? t('bills.cancelling') : t('bills.cancelYes', { billNo: bill.billNo })}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(false);
            setReason('');
            cancel.reset();
          }}
        >
          {t('bills.keep')}
        </Button>
      </div>
    </div>
  );
}

/** A saved bill, read-only: lines, totals, payments; Reprint, and Cancel for a completed one. */
function BillView({ bill }: { bill: Bill }) {
  const me = useMe().data;
  const canCancel = me?.permissions.includes('bill:cancel') ?? false;
  const [printing, setPrinting] = useState(false);
  const [printProblem, setPrintProblem] = useState<string | null>(null);

  function reprint() {
    setPrinting(true);
    setPrintProblem(null);
    printReceipt(bill.id)
      .catch((error: unknown) => setPrintProblem(errorMessage(error)))
      .finally(() => setPrinting(false));
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('bills.billTitle', { billNo: bill.billNo })}</h1>
          <p className="text-slate-700">
            {formatDateTime(bill.createdAt)} · {bill.cashier.fullName}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <BillStatusBadge status={bill.status} />
          <Link to="/bills" className="py-2 text-blue-800 underline-offset-4 hover:underline">
            {t('bills.backToList')}
          </Link>
        </div>
      </header>

      {bill.status === 'cancelled' && bill.cancelledBy && bill.cancelledAt && (
        <Notice>
          {t('bills.cancelledLine', {
            name: bill.cancelledBy.fullName,
            when: formatDateTime(bill.cancelledAt),
            reason: bill.cancelReason ?? '',
          })}
        </Notice>
      )}

      <Card className="flex flex-col gap-1">
        <p>
          {bill.customer
            ? t('bills.customerLine', {
                customer: bill.customer.name
                  ? `${bill.customer.name} (${bill.customer.phone})`
                  : bill.customer.phone,
              })
            : t('bills.walkIn')}
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t('bills.linesTitle')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300">
                <th className={cell}>{t('billing.col.item')}</th>
                <th className={`${cell} text-right`}>{t('billing.col.price')}</th>
                <th className={`${cell} text-right`}>{t('billing.col.quantity')}</th>
                <th className={`${cell} text-right`}>{t('billing.col.discount')}</th>
                <th className="py-2 text-right">{t('billing.col.total')}</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line) => (
                <tr key={line.lineNo} className="border-b border-slate-100">
                  <td className={cell}>
                    {line.itemName}{' '}
                    <span className="text-slate-600">
                      {t('picker.codeLine', { code: line.itemCode })}
                    </span>
                  </td>
                  <td className={`${cell} text-right`}>{formatPaise(line.unitPricePaise)}</td>
                  <td className={`${cell} text-right`}>{line.quantity}</td>
                  <td className={`${cell} text-right`}>
                    {line.discountPaise > 0 ? formatPaise(line.discountPaise) : '—'}
                  </td>
                  <td className="py-2 text-right">{formatPaise(line.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="mt-4 ml-auto flex max-w-xs flex-col gap-1">
          <div className="flex justify-between">
            <dt>{t('billing.subtotal')}</dt>
            <dd>{formatPaise(bill.subtotalPaise)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t('billing.discount')}</dt>
            <dd>−{formatPaise(bill.discountPaise)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t('billing.roundOff')}</dt>
            <dd>
              {bill.roundOffPaise >= 0 ? '+' : '−'}
              {formatPaise(Math.abs(bill.roundOffPaise))}
            </dd>
          </div>
          <div className="flex justify-between border-t border-slate-300 pt-1 text-lg font-semibold">
            <dt>{t('billing.total')}</dt>
            <dd>{formatPaise(bill.totalPaise)}</dd>
          </div>
          {bill.payments.map((payment) => (
            <div key={payment.mode} className="flex justify-between text-slate-700">
              <dt>{t(modeLabel[payment.mode])}</dt>
              <dd>{formatPaise(payment.amountPaise)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <Button variant="secondary" disabled={printing} onClick={reprint}>
            {printing ? t('bills.printing') : t('bills.reprint')}
          </Button>
        </div>
        {printProblem && (
          <ErrorAlert>{t('bills.printFailed', { reason: printProblem })}</ErrorAlert>
        )}
        {bill.status === 'completed' && canCancel && <CancelBill key={bill.id} bill={bill} />}
      </Card>
    </div>
  );
}

/** /bills/:id: one saved bill. */
export function BillDetailPage() {
  const { id: param } = useParams();
  const id = Number(param);
  const valid = Number.isInteger(id) && id > 0;
  const bill = useBill(valid ? id : null);

  if (!valid) return <ErrorAlert>{t('error.NOT_FOUND')}</ErrorAlert>;
  if (bill.isPending) return <p role="status">{t('common.loading')}</p>;
  if (bill.isError) return <QueryProblem error={bill.error} onRetry={() => void bill.refetch()} />;
  return <BillView bill={bill.data} />;
}
