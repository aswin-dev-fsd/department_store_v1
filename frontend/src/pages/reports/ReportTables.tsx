import {
  formatPaise,
  PAYMENT_MODES,
  type DaySummary,
  type DayTotals,
  type ItemSalesReport,
  type Page,
  type PurchaseRegister,
  type StockReportRow,
} from '@ds/shared';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui';
import { t } from '../../i18n/t';
import '../../print/report.css';

// The report tables, shared by the cashier's and the Admin's screens. Every amount goes through
// formatPaise; totals rows are bold. Styled for the screen with Tailwind and for A4 paper by
// print/report.css.

const th = 'px-2 py-2 text-left font-medium';
const thRight = 'px-2 py-2 text-right font-medium';
const td = 'px-2 py-1.5';
const tdRight = 'px-2 py-1.5 text-right whitespace-nowrap';

const modeLabel = {
  cash: 'receipt.mode.cash',
  upi: 'receipt.mode.upi',
  card: 'receipt.mode.card',
} as const;

/** Prints the page as it is: the report, without the menus (print/report.css). */
export function PrintButton() {
  return (
    <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
      {t('reports.print')}
    </Button>
  );
}

/** A table with a caption, scrolling sideways on a narrow screen. */
function ReportTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="report-table overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="mb-2 text-left text-base font-semibold">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** One day's figures as label / amount rows, the way a cashier counts the drawer. */
export function DayTotalsList({ totals }: { totals: DayTotals }) {
  const row = (label: string, value: string, strong = false) => (
    <div
      className={`flex justify-between border-b border-slate-100 py-1.5 ${strong ? 'text-lg font-semibold' : ''}`}
    >
      <dt>{label}</dt>
      <dd className="whitespace-nowrap">{value}</dd>
    </div>
  );
  return (
    <dl className="report-list">
      {row(t('reports.billCount'), String(totals.billCount))}
      {row(t('reports.subtotal'), formatPaise(totals.subtotalPaise))}
      {row(t('reports.discount'), `−${formatPaise(totals.discountPaise)}`)}
      {row(t('reports.roundOff'), formatPaise(totals.roundOffPaise))}
      {row(t('reports.netTotal'), formatPaise(totals.totalPaise), true)}
      {PAYMENT_MODES.map((mode) => row(t(modeLabel[mode]), formatPaise(totals.payments[mode])))}
      {row(
        t('reports.cancelled'),
        t('reports.cancelledValue', {
          count: totals.cancelledCount,
          value: formatPaise(totals.cancelledPaise),
        }),
      )}
    </dl>
  );
}

/** The day summary's columns, for one row of figures. */
function DayCells({ totals }: { totals: DayTotals }) {
  return (
    <>
      <td className={tdRight}>{totals.billCount}</td>
      <td className={tdRight}>{formatPaise(totals.subtotalPaise)}</td>
      <td className={tdRight}>{formatPaise(totals.discountPaise)}</td>
      <td className={tdRight}>{formatPaise(totals.roundOffPaise)}</td>
      <td className={tdRight}>{formatPaise(totals.totalPaise)}</td>
      {PAYMENT_MODES.map((mode) => (
        <td key={mode} className={tdRight}>
          {formatPaise(totals.payments[mode])}
        </td>
      ))}
      <td className={tdRight}>
        {t('reports.cancelledValue', {
          count: totals.cancelledCount,
          value: formatPaise(totals.cancelledPaise),
        })}
      </td>
    </>
  );
}

/** The day summary for the Admin: a row per cashier, a total per branch, and the grand total. */
export function DaySummaryTable({ summary }: { summary: DaySummary }) {
  if (summary.branches.length === 0) {
    return <p className="text-slate-700">{t('reports.noBills')}</p>;
  }
  return (
    <ReportTable caption={t('reports.daySummaryCaption', { date: summary.date })}>
      <thead>
        <tr className="border-b border-slate-300">
          <th className={th}>{t('reports.col.who')}</th>
          <th className={thRight}>{t('reports.billCount')}</th>
          <th className={thRight}>{t('reports.subtotal')}</th>
          <th className={thRight}>{t('reports.discount')}</th>
          <th className={thRight}>{t('reports.roundOff')}</th>
          <th className={thRight}>{t('reports.netTotal')}</th>
          {PAYMENT_MODES.map((mode) => (
            <th key={mode} className={thRight}>
              {t(modeLabel[mode])}
            </th>
          ))}
          <th className={thRight}>{t('reports.cancelled')}</th>
        </tr>
      </thead>
      {summary.branches.map((branch) => (
        <tbody key={branch.branch.id}>
          {branch.cashiers.map((cashier) => (
            <tr key={cashier.cashier.id} className="border-b border-slate-100">
              <td className={td}>{cashier.cashier.fullName}</td>
              <DayCells totals={cashier.totals} />
            </tr>
          ))}
          <tr className="border-b border-slate-300 bg-slate-50 font-semibold">
            <td className={td}>
              {t('reports.branchTotal', {
                branch: `${branch.branch.code} — ${branch.branch.name}`,
              })}
            </td>
            <DayCells totals={branch.totals} />
          </tr>
        </tbody>
      ))}
      <tfoot>
        <tr className="border-t-2 border-slate-400 font-bold">
          <td className={td}>{t('reports.grandTotal')}</td>
          <DayCells totals={summary.totals} />
        </tr>
      </tfoot>
    </ReportTable>
  );
}

/** Stock or low stock: item, branch, category, price, reorder level and packs on hand. */
export function StockTable({ page, low }: { page: Page<StockReportRow>; low: boolean }) {
  if (page.items.length === 0) {
    return <p className="text-slate-700">{low ? t('reports.noLowStock') : t('stock.empty')}</p>;
  }
  return (
    <ReportTable caption={low ? t('reports.lowStockCaption') : t('reports.stockCaption')}>
      <thead>
        <tr className="border-b border-slate-300">
          <th className={th}>{t('reports.col.item')}</th>
          <th className={th}>{t('reports.col.branch')}</th>
          <th className={th}>{t('reports.col.category')}</th>
          <th className={thRight}>{t('reports.col.price')}</th>
          <th className={thRight}>{t('reports.col.reorder')}</th>
          <th className={thRight}>{t('reports.col.inStock')}</th>
        </tr>
      </thead>
      <tbody>
        {page.items.map((row) => (
          <tr key={row.item.id} className="border-b border-slate-100">
            <td className={td}>
              {row.item.name} <span className="font-mono text-slate-600">{row.item.code}</span>
            </td>
            <td className={td}>{row.branch.code}</td>
            <td className={td}>{row.category?.name ?? '—'}</td>
            <td className={tdRight}>{formatPaise(row.sellingPricePaise)}</td>
            <td className={tdRight}>{row.reorderLevel ?? '—'}</td>
            <td className={`${tdRight} font-semibold`}>{row.quantity}</td>
          </tr>
        ))}
      </tbody>
    </ReportTable>
  );
}

/** Item-wise sales: one row per item, then the range's totals and the round-off note. */
export function ItemSalesTable({ report }: { report: ItemSalesReport }) {
  if (report.total === 0) return <p className="text-slate-700">{t('reports.noSales')}</p>;
  return (
    <>
      <ReportTable caption={t('reports.itemSalesCaption', { from: report.from, to: report.to })}>
        <thead>
          <tr className="border-b border-slate-300">
            <th className={th}>{t('reports.col.item')}</th>
            <th className={th}>{t('reports.col.branch')}</th>
            <th className={thRight}>{t('reports.col.packs')}</th>
            <th className={thRight}>{t('reports.col.value')}</th>
          </tr>
        </thead>
        <tbody>
          {report.items.map((row) => (
            <tr key={row.item.id} className="border-b border-slate-100">
              <td className={td}>
                {row.item.name} <span className="font-mono text-slate-600">{row.item.code}</span>
              </td>
              <td className={td}>{row.branch.code}</td>
              <td className={tdRight}>{row.quantity}</td>
              <td className={tdRight}>{formatPaise(row.valuePaise)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-400 font-semibold">
            <td className={td} colSpan={3}>
              {t('reports.itemsValue')}
            </td>
            <td className={tdRight}>{formatPaise(report.itemsValuePaise)}</td>
          </tr>
          <tr>
            <td className={td} colSpan={3}>
              {t('reports.roundOff')}
            </td>
            <td className={tdRight}>{formatPaise(report.roundOffPaise)}</td>
          </tr>
          <tr className="font-bold">
            <td className={td} colSpan={3}>
              {t('reports.billsTotal')}
            </td>
            <td className={tdRight}>{formatPaise(report.billsTotalPaise)}</td>
          </tr>
        </tfoot>
      </ReportTable>
      <p className="text-sm text-slate-600">{t('reports.roundOffNote')}</p>
    </>
  );
}

/** The purchase register: purchases by vendor with subtotals, the total, then the cancelled. */
export function PurchaseRegisterTables({ register }: { register: PurchaseRegister }) {
  const head = (
    <thead>
      <tr className="border-b border-slate-300">
        <th className={th}>{t('reports.col.vendor')}</th>
        <th className={th}>{t('reports.col.branch')}</th>
        <th className={th}>{t('reports.col.invoice')}</th>
        <th className={th}>{t('reports.col.invoiceDate')}</th>
        <th className={thRight}>{t('reports.col.amount')}</th>
      </tr>
    </thead>
  );
  return (
    <div className="flex flex-col gap-6">
      {register.vendors.length === 0 ? (
        <p className="text-slate-700">{t('reports.noPurchases')}</p>
      ) : (
        <ReportTable
          caption={t('reports.registerCaption', { from: register.from, to: register.to })}
        >
          {head}
          {register.vendors.map((group) => (
            <tbody key={group.vendor.id}>
              {group.purchases.map((purchase) => (
                <tr key={purchase.id} className="border-b border-slate-100">
                  <td className={td}>{group.vendor.name}</td>
                  <td className={td}>{group.branch.code}</td>
                  <td className={td}>{purchase.vendorInvoiceNo}</td>
                  <td className={td}>{purchase.invoiceDate}</td>
                  <td className={tdRight}>{formatPaise(purchase.totalPaise)}</td>
                </tr>
              ))}
              <tr className="border-b border-slate-300 bg-slate-50 font-semibold">
                <td className={td} colSpan={4}>
                  {t('reports.vendorSubtotal', { vendor: group.vendor.name })}
                </td>
                <td className={tdRight}>{formatPaise(group.subtotalPaise)}</td>
              </tr>
            </tbody>
          ))}
          <tfoot>
            <tr className="border-t-2 border-slate-400 font-bold">
              <td className={td} colSpan={4}>
                {t('reports.grandTotal')}
              </td>
              <td className={tdRight}>{formatPaise(register.totalPaise)}</td>
            </tr>
          </tfoot>
        </ReportTable>
      )}
      {register.cancelled.length > 0 && (
        <ReportTable caption={t('reports.cancelledPurchases')}>
          <thead>
            <tr className="border-b border-slate-300">
              <th className={th}>{t('reports.col.vendor')}</th>
              <th className={th}>{t('reports.col.branch')}</th>
              <th className={th}>{t('reports.col.invoice')}</th>
              <th className={th}>{t('reports.col.invoiceDate')}</th>
              <th className={th}>{t('reports.col.reason')}</th>
              <th className={thRight}>{t('reports.col.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {register.cancelled.map((purchase) => (
              <tr key={purchase.id} className="border-b border-slate-100">
                <td className={td}>{purchase.vendor.name}</td>
                <td className={td}>{purchase.branch.code}</td>
                <td className={td}>{purchase.vendorInvoiceNo}</td>
                <td className={td}>{purchase.invoiceDate}</td>
                <td className={td}>{purchase.cancelReason ?? '—'}</td>
                <td className={tdRight}>{formatPaise(purchase.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </ReportTable>
      )}
    </div>
  );
}
