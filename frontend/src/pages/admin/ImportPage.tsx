import type { ImportError } from '@ds/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { importProblems, useImportItems } from '../../admin/import';
import { useBranchOptions } from '../../admin/queries';
import { QueryProblem } from '../../components/QueryProblem';
import { Button, Card, ErrorAlert, SelectField, TextField } from '../../components/ui';
import { describeFailure, type FieldErrors } from '../../forms/fieldErrors';
import { t } from '../../i18n/t';

const head = 'px-2 py-2 font-medium';

/** Every problem the server found in the file: the row, the column and what is wrong. */
function ProblemsTable({ problems }: { problems: ImportError[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ErrorAlert>{t('import.problemsSummary', { count: problems.length })}</ErrorAlert>
      <p className="text-sm text-slate-700">{t('import.rowHint')}</p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <caption className="sr-only">{t('import.problemsTitle')}</caption>
          <thead>
            <tr className="border-b border-slate-300 text-slate-700">
              <th scope="col" className={head}>
                {t('import.colRow')}
              </th>
              <th scope="col" className={head}>
                {t('import.colColumn')}
              </th>
              <th scope="col" className={head}>
                {t('import.colProblem')}
              </th>
            </tr>
          </thead>
          <tbody>
            {problems.map((problem) => (
              <tr
                key={`${problem.row}:${problem.column ?? ''}`}
                className="border-b border-slate-200 align-top"
              >
                <td className="px-2 py-2 font-mono">{problem.row}</td>
                <td className="px-2 py-2 font-mono">{problem.column ?? '–'}</td>
                <td className="px-2 py-2">{problem.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Admin → Import: load a branch's items and opening stock from a CSV file. */
export function ImportPage() {
  const branches = useBranchOptions();
  const importItems = useImportItems();
  const [branchId, setBranchId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [reading, setReading] = useState(false);
  // Changing this remounts the form, which empties the file picker (code cannot set a file input)
  const [formKey, setFormKey] = useState(0);

  const chosen = (branches.data ?? []).find((branch) => String(branch.id) === branchId);
  const busy = importItems.isPending || reading;
  const problems = importProblems(importItems.error);
  const failure = describeFailure(importItems.error);

  /** A different branch or file makes the last answer stale. */
  function forgetAnswer() {
    if (importItems.isSuccess || importItems.isError) importItems.reset();
  }

  function startOver() {
    importItems.reset();
    setFile(null);
    setErrors({});
    setFormKey((key) => key + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Inputs stay focusable while sending, so Enter could submit twice
    if (busy) return;

    const next: FieldErrors = {};
    if (chosen === undefined) next.branch = t('import.chooseBranch');
    if (file === null) next.file = t('import.chooseFile');
    setErrors(next);
    if (chosen === undefined || file === null) return;

    setReading(true);
    let csv: string;
    try {
      csv = await file.text();
    } catch {
      setErrors({ file: t('import.unreadable') });
      return;
    } finally {
      setReading(false);
    }
    importItems.mutate({ branchId: chosen.id, csv });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="text-xl font-semibold">{t('import.title')}</h1>
        <p className="text-slate-700">{t('import.intro')}</p>
      </header>

      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t('import.formatTitle')}</h2>
        <ul className="list-disc space-y-1 pl-5 text-slate-800">
          <li>{t('import.format1')}</li>
          <li>{t('import.format2')}</li>
          <li>{t('import.format3')}</li>
          <li>{t('import.format4')}</li>
        </ul>
        <p className="mt-3">
          <a
            href="/import-template.csv"
            download
            className="font-medium text-blue-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            {t('import.template')}
          </a>
        </p>
      </Card>

      {branches.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : branches.isError ? (
        <QueryProblem error={branches.error} onRetry={() => void branches.refetch()} />
      ) : branches.data.length === 0 ? (
        <p className="text-slate-700">
          {t('import.noBranches')}{' '}
          <Link to="/admin/branches" className="font-medium text-blue-800 underline">
            {t('import.noBranchesLink')}
          </Link>
        </p>
      ) : (
        <Card>
          <form key={formKey} onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
            <SelectField
              label={t('import.branch')}
              name="branch"
              value={branchId}
              error={errors.branch}
              disabled={busy}
              onChange={(event) => {
                setBranchId(event.target.value);
                forgetAnswer();
              }}
            >
              <option value="">{t('import.chooseBranchOption')}</option>
              {branches.data.map((branch) => (
                <option key={branch.id} value={String(branch.id)}>
                  {`${branch.code} — ${branch.name}`}
                </option>
              ))}
            </SelectField>
            <TextField
              label={t('import.file')}
              name="file"
              type="file"
              accept=".csv,text/csv"
              error={errors.file}
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                forgetAnswer();
              }}
            />
            <div>
              <Button type="submit" disabled={busy} aria-busy={busy}>
                {busy
                  ? t('import.importing')
                  : chosen
                    ? t('import.submitTo', { branch: chosen.code })
                    : t('import.submit')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {importItems.isSuccess && (
        <Card>
          <h2 className="text-lg font-semibold">{t('import.doneTitle')}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-800">
            <li>{t('import.doneItems', { items: importItems.data.itemsCreated })}</li>
            <li>
              {t('import.doneCategories', { categories: importItems.data.categoriesCreated })}
            </li>
            <li>{t('import.doneStock', { stock: importItems.data.openingMovements })}</li>
          </ul>
          <div className="mt-4">
            <Button variant="secondary" onClick={startOver}>
              {t('import.another')}
            </Button>
          </div>
        </Card>
      )}

      {problems ? (
        <ProblemsTable problems={problems} />
      ) : (
        failure.message && <ErrorAlert>{failure.message}</ErrorAlert>
      )}
    </div>
  );
}
