import { formatPaise, type Purchase } from '@ds/shared';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/errors';
import { parseRupees } from '../../catalog/forms';
import { ItemPicker } from '../../components/ItemPicker';
import { QueryProblem } from '../../components/QueryProblem';
import { Button, Card, ErrorAlert, Notice, SelectField, TextField } from '../../components/ui';
import { describeFailure, type FieldErrors } from '../../forms/fieldErrors';
import type { MessageKey } from '../../i18n/en';
import { t } from '../../i18n/t';
import { formatDateTime } from '../../lib/dates';
import {
  convertEditor,
  emptyEditor,
  LINE_FIELDS,
  lineFromItem,
  lineTotalPaise,
  purchaseToEditor,
  runningTotal,
  serverEditorErrors,
  shortItemNames,
  type EditorLine,
  type EditorValues,
  type LineField,
} from '../../purchases/editor';
import {
  useCancelPurchase,
  useCreatePurchase,
  usePostPurchase,
  useUpdatePurchase,
} from '../../purchases/mutations';
import { usePurchase, useVendorOptions } from '../../purchases/queries';
import { PurchaseStatusBadge } from './PurchaseStatusBadge';

const LINE_LABELS: Record<LineField, MessageKey> = {
  quantity: 'purchases.col.quantity',
  cost: 'purchases.col.cost',
  newMrp: 'purchases.col.newMrp',
  newSellingPrice: 'purchases.col.newSellingPrice',
};

/** Where a failed save or post shows: a duplicate by the invoice number, 422s by their fields. */
function failureFields(error: unknown): { fields: FieldErrors; message: string | null } {
  const server = serverEditorErrors(error);
  if (Object.keys(server).length > 0) return { fields: server, message: null };
  return describeFailure(error, { DUPLICATE_INVOICE: 'vendorInvoiceNo' });
}

/**
 * Enter moves to the next entry field (proposed, Task 4.5 step 4); after the last field of the
 * last line it goes back to the item box, ready for the next item.
 */
function moveOnEnter(event: KeyboardEvent<HTMLElement>, picker: HTMLInputElement | null) {
  const target = event.target as HTMLElement;
  if (event.key !== 'Enter' || !target.hasAttribute('data-entry')) return;
  event.preventDefault();
  const fields = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-entry]')];
  const next = fields[fields.indexOf(target) + 1];
  (next ?? picker)?.focus();
}

interface DraftEditorProps {
  /** The saved draft, or null for a new one. */
  purchase: Purchase | null;
}

/** The draft editor: header, lines, running total, Save draft, and Post. */
function DraftEditor({ purchase }: DraftEditorProps) {
  const navigate = useNavigate();
  const [values, setValues] = useState<EditorValues>(() =>
    purchase ? purchaseToEditor(purchase) : emptyEditor(),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingPost, setConfirmingPost] = useState(false);
  const [vendorSearch, setVendorSearch] = useState('');
  const pickerRef = useRef<HTMLInputElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);

  const vendors = useVendorOptions();
  const create = useCreatePurchase();
  const update = useUpdatePurchase();
  const post = usePostPurchase();
  const lastError = post.error ?? update.error ?? create.error;
  const failure = failureFields(lastError);
  const shown = { ...failure.fields, ...errors };
  const busy = create.isPending || update.isPending || post.isPending;
  const total = runningTotal(values.lines);

  const vendorChoices = (vendors.data ?? []).filter(
    (vendor) =>
      vendor.name.toLowerCase().includes(vendorSearch.trim().toLowerCase()) ||
      String(vendor.id) === values.vendorId,
  );

  function change(next: Partial<EditorValues>) {
    setValues((current) => ({ ...current, ...next }));
    setDirty(true);
    setSaved(false);
  }

  function changeLine(key: string, field: LineField, text: string) {
    change({
      lines: values.lines.map((line) => (line.key === key ? { ...line, [field]: text } : line)),
    });
  }

  function addLine(line: EditorLine) {
    change({ lines: [...values.lines, line] });
    // Straight to the new line's quantity once it is on screen
    requestAnimationFrame(() =>
      linesRef.current
        ?.querySelector<HTMLInputElement>(`[data-line="${line.key}"][data-field="quantity"]`)
        ?.focus(),
    );
  }

  /** Save the draft; resolves to its id, or null when it could not be saved. */
  async function save(): Promise<number | null> {
    create.reset();
    update.reset();
    post.reset();
    const result = convertEditor(values);
    if (!result.ok) {
      setErrors(result.errors);
      return null;
    }
    setErrors({});
    try {
      if (purchase === null) {
        const created = await create.mutateAsync(result.draft);
        setDirty(false);
        navigate(`/purchases/${created.id}`, { replace: true });
        return created.id;
      }
      await update.mutateAsync({ id: purchase.id, draft: result.draft });
      setDirty(false);
      setSaved(true);
      return purchase.id;
    } catch {
      return null;
    }
  }

  async function saveAndPost() {
    const id = purchase !== null && !dirty ? purchase.id : await save();
    if (id === null) {
      setConfirmingPost(false);
      return;
    }
    try {
      await post.mutateAsync(id);
      if (purchase === null) navigate(`/purchases/${id}`, { replace: true });
    } catch {
      setConfirmingPost(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {purchase ? t('purchases.editTitle') : t('purchases.newTitle')}
          </h1>
          <p className="text-slate-700">{t('purchases.editorIntro')}</p>
        </div>
        <Link to="/purchases" className="py-2 text-blue-800 underline-offset-4 hover:underline">
          {t('purchases.backToList')}
        </Link>
      </header>

      <div
        ref={linesRef}
        onKeyDown={(event) => moveOnEnter(event, pickerRef.current)}
        className="flex flex-col gap-6"
      >
        <Card className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('purchases.vendorSearch')}
            name="vendorSearch"
            type="search"
            autoComplete="off"
            value={vendorSearch}
            onChange={(event) => setVendorSearch(event.target.value)}
          />
          <SelectField
            label={t('purchases.vendor')}
            name="vendorId"
            data-entry=""
            value={values.vendorId}
            error={shown.vendorId}
            onChange={(event) => change({ vendorId: event.target.value })}
          >
            <option value="">{t('purchases.chooseVendor')}</option>
            {vendorChoices.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t('purchases.invoiceNo')}
            name="vendorInvoiceNo"
            data-entry=""
            autoComplete="off"
            maxLength={50}
            value={values.vendorInvoiceNo}
            error={shown.vendorInvoiceNo}
            onChange={(event) => change({ vendorInvoiceNo: event.target.value })}
          />
          <TextField
            label={t('purchases.invoiceDate')}
            name="invoiceDate"
            type="date"
            data-entry=""
            value={values.invoiceDate}
            error={shown.invoiceDate}
            onChange={(event) => change({ invoiceDate: event.target.value })}
          />
          <div className="md:col-span-2">
            <TextField
              label={t('purchases.notes')}
              name="notes"
              autoComplete="off"
              maxLength={500}
              value={values.notes}
              error={shown.notes}
              onChange={(event) => change({ notes: event.target.value })}
            />
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t('purchases.linesTitle')}</h2>
          {shown.lines && <ErrorAlert>{shown.lines}</ErrorAlert>}
          {values.lines.length === 0 ? (
            <p className="text-slate-700">{t('purchases.noLines')}</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {values.lines.map((line, index) => {
                const lineTotal = lineTotalPaise(line);
                return (
                  <li key={line.key} className="rounded-md border border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">
                        {index + 1}. {line.itemName}{' '}
                        <span className="text-sm text-slate-600">
                          {t('picker.codeLine', { code: line.itemCode })}
                        </span>
                      </p>
                      <p className="text-sm text-slate-700">
                        {lineTotal === null
                          ? t('purchases.lineTotal', { total: '—' })
                          : t('purchases.lineTotalWorked', {
                              quantity: line.quantity.trim(),
                              cost: formatPaise(parseRupees(line.cost) ?? 0),
                              total: formatPaise(lineTotal),
                            })}
                      </p>
                    </div>
                    {shown[`lines.${index}.item`] && (
                      <ErrorAlert>{shown[`lines.${index}.item`]}</ErrorAlert>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
                      {LINE_FIELDS.map((field) => (
                        <TextField
                          key={field}
                          label={t(LINE_LABELS[field])}
                          name={`${field}-${line.key}`}
                          data-entry=""
                          data-line={line.key}
                          data-field={field}
                          inputMode={field === 'quantity' ? 'numeric' : 'decimal'}
                          autoComplete="off"
                          value={line[field]}
                          error={shown[`lines.${index}.${field}`]}
                          onChange={(event) => changeLine(line.key, field, event.target.value)}
                        />
                      ))}
                      <Button
                        variant="secondary"
                        aria-label={t('purchases.removeLineNamed', { name: line.itemName })}
                        onClick={() =>
                          change({ lines: values.lines.filter((other) => other.key !== line.key) })
                        }
                      >
                        {t('purchases.removeLine')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <ItemPicker inputRef={pickerRef} onPick={(item) => addLine(lineFromItem(item))} />
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <p className="text-lg font-semibold" aria-live="polite">
          {t('purchases.runningTotal', { total: formatPaise(total.totalPaise) })}
          {total.incomplete > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-600">
              {t('purchases.incompleteLines', { count: total.incomplete })}
            </span>
          )}
        </p>
        {Object.keys(errors).length > 0 && <ErrorAlert>{t('purchases.fixProblems')}</ErrorAlert>}
        {failure.message && <ErrorAlert>{failure.message}</ErrorAlert>}
        {saved && !dirty && <Notice>{t('purchases.saved')}</Notice>}
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => void save()}>
            {create.isPending || update.isPending ? t('common.saving') : t('purchases.saveDraft')}
          </Button>
          <Button
            disabled={busy || values.lines.length === 0}
            onClick={() => setConfirmingPost(true)}
          >
            {t('purchases.post')}
          </Button>
        </div>
        {confirmingPost && (
          <div
            role="group"
            aria-labelledby="post-confirm"
            className="rounded-md border border-amber-300 bg-amber-50 p-4"
          >
            <p id="post-confirm" className="mb-3 text-sm text-amber-950">
              {t('purchases.postConfirm', {
                count: values.lines.length,
                total: formatPaise(total.totalPaise),
              })}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy} onClick={() => void saveAndPost()}>
                {post.isPending ? t('purchases.posting') : t('purchases.postYes')}
              </Button>
              <Button variant="secondary" autoFocus onClick={() => setConfirmingPost(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** A posted or cancelled purchase, read-only; a posted one can be cancelled with a reason. */
function PurchaseView({ purchase }: { purchase: Purchase }) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useCancelPurchase();
  const short = shortItemNames(cancel.error);
  const reasonError = describeFailure(cancel.error).fields.reason;
  const otherProblem =
    cancel.error && reasonError === undefined && short.length === 0
      ? errorMessage(cancel.error)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {t('purchases.invoiceLine', { invoice: purchase.vendorInvoiceNo })}
          </h1>
          <p className="text-slate-700">
            {purchase.vendor.name} · {t('purchases.dateLine', { date: purchase.invoiceDate })}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <PurchaseStatusBadge status={purchase.status} />
          <Link to="/purchases" className="py-2 text-blue-800 underline-offset-4 hover:underline">
            {t('purchases.backToList')}
          </Link>
        </div>
      </header>

      <Card className="flex flex-col gap-2">
        {purchase.postedBy && purchase.postedAt && (
          <p>
            {t('purchases.postedLine', {
              name: purchase.postedBy.fullName,
              when: formatDateTime(purchase.postedAt),
            })}
          </p>
        )}
        {purchase.cancelledBy && purchase.cancelledAt && (
          <p>
            {t('purchases.cancelledLine', {
              name: purchase.cancelledBy.fullName,
              when: formatDateTime(purchase.cancelledAt),
              reason: purchase.cancelReason ?? '',
            })}
          </p>
        )}
        {purchase.notes && <p className="text-slate-700">{purchase.notes}</p>}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t('purchases.linesTitle')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-2 pr-3">{t('purchases.col.item')}</th>
                <th className="py-2 pr-3 text-right">{t('purchases.col.quantity')}</th>
                <th className="py-2 pr-3 text-right">{t('purchases.col.cost')}</th>
                <th className="py-2 pr-3 text-right">{t('purchases.col.newMrp')}</th>
                <th className="py-2 pr-3 text-right">{t('purchases.col.newSellingPrice')}</th>
                <th className="py-2 text-right">{t('purchases.col.total')}</th>
              </tr>
            </thead>
            <tbody>
              {purchase.lines.map((line) => (
                <tr key={line.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">
                    {line.itemName}{' '}
                    <span className="text-slate-600">
                      {t('picker.codeLine', { code: line.itemCode })}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">{line.quantity}</td>
                  <td className="py-2 pr-3 text-right">{formatPaise(line.costPricePaise)}</td>
                  <td className="py-2 pr-3 text-right">
                    {line.newMrpPaise === null ? '—' : formatPaise(line.newMrpPaise)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {line.newSellingPricePaise === null
                      ? '—'
                      : formatPaise(line.newSellingPricePaise)}
                  </td>
                  <td className="py-2 text-right">{formatPaise(line.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-right text-lg font-semibold">
          {t('purchases.runningTotal', { total: formatPaise(purchase.totalPaise) })}
        </p>
      </Card>

      {purchase.status === 'posted' && (
        <Card className="flex flex-col gap-4">
          {!cancelling ? (
            <div>
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                {t('purchases.cancel')}
              </Button>
            </div>
          ) : (
            <div
              role="group"
              aria-labelledby="cancel-confirm"
              className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4"
            >
              <p id="cancel-confirm" className="text-sm text-amber-950">
                {t('purchases.cancelConfirm')}
              </p>
              <TextField
                label={t('purchases.cancelReason')}
                name="reason"
                autoComplete="off"
                maxLength={200}
                autoFocus
                value={reason}
                error={reasonError}
                onChange={(event) => setReason(event.target.value)}
              />
              {short.length > 0 && (
                <ErrorAlert>{t('purchases.alreadySold', { items: short.join(', ') })}</ErrorAlert>
              )}
              {otherProblem && <ErrorAlert>{otherProblem}</ErrorAlert>}
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="danger"
                  disabled={cancel.isPending || reason.trim().length < 3}
                  onClick={() => cancel.mutate({ id: purchase.id, input: { reason } })}
                >
                  {cancel.isPending ? t('purchases.cancelling') : t('purchases.cancelYes')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCancelling(false);
                    cancel.reset();
                  }}
                >
                  {t('purchases.keep')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** /purchases/new and /purchases/:id: a draft opens in the editor, anything else read-only. */
export function PurchaseEditorPage() {
  const { id: param } = useParams();
  const id = param === undefined || param === 'new' ? null : Number(param);
  const valid = id === null || (Number.isInteger(id) && id > 0);
  const purchase = usePurchase(valid ? id : null);

  if (!valid) return <ErrorAlert>{t('error.NOT_FOUND')}</ErrorAlert>;
  if (id === null) return <DraftEditor key="new" purchase={null} />;
  if (purchase.isPending) return <p role="status">{t('common.loading')}</p>;
  if (purchase.isError) {
    return <QueryProblem error={purchase.error} onRetry={() => void purchase.refetch()} />;
  }
  return purchase.data.status === 'draft' ? (
    <DraftEditor key={purchase.data.id} purchase={purchase.data} />
  ) : (
    <PurchaseView purchase={purchase.data} />
  );
}
