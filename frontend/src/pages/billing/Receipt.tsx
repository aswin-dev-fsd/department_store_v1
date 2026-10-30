import { formatPaise, type PaymentMode, type Receipt as ReceiptData } from '@ds/shared';
import { t } from '../../i18n/t';

const modeLabel = {
  cash: 'receipt.mode.cash',
  upi: 'receipt.mode.upi',
  card: 'receipt.mode.card',
} as const satisfies Record<PaymentMode, string>;

/** A label on the left and an amount on the right, on one receipt row. */
function Row({ label, amount, strong }: { label: string; amount: string; strong?: boolean }) {
  return (
    <div className={strong ? 'receipt-row receipt-strong' : 'receipt-row'}>
      <span>{label}</span>
      <span>{amount}</span>
    </div>
  );
}

/**
 * An 80mm thermal receipt (PD-04) from `GET /bills/:id/receipt`: the server decides every word
 * and number, this only lays them out. Styled by `print/receipt.css`, never by the app's styles,
 * because it is printed from a separate frame.
 */
export function Receipt({ receipt }: { receipt: ReceiptData }) {
  const cancelled = receipt.status === 'cancelled';
  const roundOff = receipt.roundOffPaise;

  return (
    <article className="receipt">
      {cancelled && (
        <div className="receipt-cancelled">
          <p>{t('receipt.cancelled')}</p>
          {receipt.cancelReason && <p>{receipt.cancelReason}</p>}
        </div>
      )}

      <header className="receipt-center">
        <p className="receipt-business">{receipt.business.name}</p>
        <p>{receipt.branch.name}</p>
        <p>{receipt.branch.address}</p>
        {receipt.branch.phone && <p>{t('receipt.phone', { phone: receipt.branch.phone })}</p>}
      </header>

      <hr />
      <p>{t('receipt.billNo', { billNo: receipt.billNo })}</p>
      <p>{t('receipt.issuedAt', { at: receipt.issuedAtIst })}</p>
      <p>{t('receipt.cashier', { name: receipt.cashierName })}</p>
      {receipt.customer && (
        <p>
          {t('receipt.customer', {
            customer: receipt.customer.name
              ? `${receipt.customer.name} (${receipt.customer.phone})`
              : receipt.customer.phone,
          })}
        </p>
      )}
      <hr />

      {receipt.lines.map((line) => (
        <div key={line.lineNo} className="receipt-line">
          <p className="receipt-name">{line.itemName}</p>
          <Row
            label={`${line.quantity} × ${formatPaise(line.unitPricePaise)}`}
            amount={formatPaise(line.quantity * line.unitPricePaise)}
          />
          {line.discountPaise > 0 && (
            <Row label={t('receipt.lineDiscount')} amount={`−${formatPaise(line.discountPaise)}`} />
          )}
          {line.discountPaise > 0 && (
            <Row label={t('receipt.lineTotal')} amount={formatPaise(line.lineTotalPaise)} />
          )}
        </div>
      ))}

      <hr />
      <Row label={t('receipt.subtotal')} amount={formatPaise(receipt.subtotalPaise)} />
      {receipt.discountPaise > 0 && (
        <Row label={t('receipt.discount')} amount={`−${formatPaise(receipt.discountPaise)}`} />
      )}
      {roundOff !== 0 && (
        <Row
          label={t('receipt.roundOff')}
          amount={`${roundOff > 0 ? '+' : '−'}${formatPaise(Math.abs(roundOff))}`}
        />
      )}
      <Row label={t('receipt.total')} amount={formatPaise(receipt.totalPaise)} strong />
      <hr />
      {receipt.payments.map((payment) => (
        <Row
          key={payment.mode}
          label={t(modeLabel[payment.mode])}
          amount={formatPaise(payment.amountPaise)}
        />
      ))}

      {receipt.branch.footer && (
        <>
          <hr />
          <p className="receipt-center receipt-footer">{receipt.branch.footer}</p>
        </>
      )}
    </article>
  );
}
