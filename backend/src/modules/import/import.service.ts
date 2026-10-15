// CSV import of a branch's items and opening stock (D-24; overview §7.1). The whole file is checked
// first and every problem is reported; only a file without problems is saved, in one transaction.
// Opening stock goes through the stock ledger like any other stock change.
import type { Db } from '@ds/database';
import {
  IMPORT_COLUMNS,
  SELLING_ABOVE_MRP_MESSAGE,
  importRowSchema,
  type ImportColumn,
  type ImportError,
  type ImportResult,
  type ImportRow,
} from '@ds/shared';
import { parse } from 'csv-parse/sync';
import { logAudit } from '../../lib/audit.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError } from '../../lib/errors.js';
import type { RequestContext } from '../../middleware/auth.js';
import { postMovements, requireBranchExists, type MovementInput } from '../stock/stock.service.js';
import * as model from './import.model.js';

/** Rows per INSERT or per ledger call: far below PostgreSQL's 65,535 parameters per statement. */
const BATCH = 500;
/** Codes or barcodes per lookup query. */
const LOOKUP = 1000;
/** U+FEFF, the byte order mark that may start a UTF-8 file. */
const BOM = String.fromCharCode(0xfeff);

function batches<T>(list: T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let start = 0; start < list.length; start += size) {
    parts.push(list.slice(start, start + size));
  }
  return parts;
}

function isBlank(record: string[]): boolean {
  return record.every((cell) => cell.trim() === '');
}

/** The column a schema issue is about, or null when it is about the row. */
function columnOf(key: PropertyKey | undefined): ImportColumn | null {
  return IMPORT_COLUMNS.find((column) => column === key) ?? null;
}

/** The problems found so far. A cell reports only the first problem found in it. */
class Problems {
  readonly list: ImportError[] = [];
  private readonly reported = new Set<string>();

  add(row: number, column: ImportColumn | null, message: string): void {
    const key = `${row}:${column ?? ''}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.list.push({ row, column, message });
  }
}

interface CheckedFile {
  /** The rows that passed every check of their own, with their row number. */
  rows: { row: number; value: ImportRow }[];
  /** Every code typed in the file, even in a row with other problems. */
  codes: { row: number; code: string }[];
  /** Every barcode typed in the file, even in a row with other problems. */
  barcodes: { row: number; barcode: string }[];
  problems: Problems;
}

/**
 * Read the file and check everything that needs no database: the header, every row against the
 * row schema, the price rule, and codes and barcodes repeated inside the file. Rows are numbered
 * as in a spreadsheet: the header is row 1. Blank lines are skipped but still counted.
 */
function checkFile(csv: string): CheckedFile {
  const checked: CheckedFile = { rows: [], codes: [], barcodes: [], problems: new Problems() };
  const { problems } = checked;

  let records: string[][];
  try {
    // Excel's "CSV UTF-8" starts the file with a byte order mark, which is not part of the header
    const text = csv.startsWith(BOM) ? csv.slice(1) : csv;
    records = parse(text, { relax_column_count: true });
  } catch (error) {
    const line = (error as { lines?: unknown }).lines;
    const reason = error instanceof Error ? error.message : 'unreadable';
    problems.add(
      typeof line === 'number' ? line : 1,
      null,
      `The file is not valid CSV (${reason})`,
    );
    return checked;
  }

  const [header, ...body] = records;
  if (header === undefined || isBlank(header)) {
    problems.add(1, null, 'The file is empty: the first row must be the header row');
    return checked;
  }
  const names = header.map((name) => name.trim().toLowerCase());
  const position = new Map<ImportColumn, number>();
  for (const column of IMPORT_COLUMNS) {
    const first = names.indexOf(column);
    if (first === -1) {
      problems.add(1, column, `The header row has no "${column}" column`);
    } else if (names.indexOf(column, first + 1) !== -1) {
      problems.add(1, column, `The header row has the "${column}" column more than once`);
    } else {
      position.set(column, first);
    }
  }
  if (problems.list.length > 0) return checked;

  const firstCode = new Map<string, number>();
  const firstBarcode = new Map<string, number>();
  let hasRows = false;
  for (const [index, record] of body.entries()) {
    const row = index + 2;
    if (isBlank(record)) continue;
    hasRows = true;
    if (record.length > names.length) {
      problems.add(
        row,
        null,
        `This row has ${record.length} values but the header has ${names.length} columns. If a value contains a comma, put the value in quotes`,
      );
      continue;
    }
    const cells = Object.fromEntries(
      IMPORT_COLUMNS.map((column) => [column, record[position.get(column)!] ?? '']),
    ) as Record<ImportColumn, string>;

    const parsed = importRowSchema.safeParse(cells);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.add(row, columnOf(issue.path[0]), issue.message);
      }
    } else if (parsed.data.selling_price > parsed.data.mrp) {
      problems.add(row, 'selling_price', SELLING_ABOVE_MRP_MESSAGE);
    } else {
      checked.rows.push({ row, value: parsed.data });
    }

    // Judged on what was typed, so a repeat is reported together with the row's other problems
    const code = cells.code.trim();
    if (code !== '') {
      const first = firstCode.get(code);
      if (first === undefined) {
        firstCode.set(code, row);
      } else {
        problems.add(row, 'code', `Code "${code}" is also used on row ${first}`);
      }
      checked.codes.push({ row, code });
    }
    const barcode = cells.barcode.trim();
    if (barcode !== '') {
      const first = firstBarcode.get(barcode);
      if (first === undefined) {
        firstBarcode.set(barcode, row);
      } else {
        problems.add(row, 'barcode', `Barcode "${barcode}" is also used on row ${first}`);
      }
      checked.barcodes.push({ row, barcode });
    }
  }
  if (!hasRows) problems.add(1, null, 'The file has no items: it holds only the header row');
  return checked;
}

/** Report each code and barcode of the file that an item of the branch already has. */
async function checkAgainstBranch(db: Db, branchId: number, checked: CheckedFile): Promise<void> {
  const takenCodes = new Set<string>();
  for (const part of batches([...new Set(checked.codes.map((entry) => entry.code))], LOOKUP)) {
    for (const code of await model.findTakenCodes(db, branchId, part)) takenCodes.add(code);
  }
  for (const { row, code } of checked.codes) {
    if (takenCodes.has(code)) {
      checked.problems.add(row, 'code', `This branch already has an item with code "${code}"`);
    }
  }

  const takenBarcodes = new Set<string>();
  const barcodes = [...new Set(checked.barcodes.map((entry) => entry.barcode))];
  for (const part of batches(barcodes, LOOKUP)) {
    for (const barcode of await model.findTakenBarcodes(db, branchId, part)) {
      takenBarcodes.add(barcode);
    }
  }
  for (const { row, barcode } of checked.barcodes) {
    if (takenBarcodes.has(barcode)) {
      checked.problems.add(
        row,
        'barcode',
        `This branch already has an item with barcode "${barcode}"`,
      );
    }
  }
}

/** By row, then by the column's place in the template (a problem with the whole row first). */
function byPosition(a: ImportError, b: ImportError): number {
  const rank = (problem: ImportError) =>
    problem.column === null ? -1 : IMPORT_COLUMNS.indexOf(problem.column);
  return a.row - b.row || rank(a) - rank(b);
}

/** Create the categories, items, stock rows and opening movements of a checked file, all or nothing. */
async function save(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  rows: ImportRow[],
  ip: string | null,
): Promise<ImportResult> {
  try {
    return await db.transaction(async (tx) => {
      // Categories match by name in any letter case; the others are created once, spelt as first seen
      const categoryIds = new Map(
        (await model.listCategories(tx, branchId)).map((category) => [
          category.name.toLowerCase(),
          category.id,
        ]),
      );
      const wanted = new Map<string, string>();
      for (const { category } of rows) {
        if (category === null) continue;
        const key = category.toLowerCase();
        if (!categoryIds.has(key) && !wanted.has(key)) wanted.set(key, category);
      }
      const created = await model.insertCategories(tx, branchId, [...wanted.values()]);
      for (const category of created) categoryIds.set(category.name.toLowerCase(), category.id);

      const itemIds = new Map<string, number>();
      for (const part of batches(rows, BATCH)) {
        const inserted = await model.insertItems(
          tx,
          part.map((row) => ({
            branchId,
            code: row.code,
            barcode: row.barcode,
            name: row.name,
            categoryId:
              row.category === null ? null : (categoryIds.get(row.category.toLowerCase()) ?? null),
            mrpPaise: row.mrp,
            sellingPricePaise: row.selling_price,
            reorderLevel: row.reorder_level,
          })),
        );
        await model.insertStockRows(
          tx,
          inserted.map((item) => item.id),
        );
        for (const item of inserted) itemIds.set(item.code, item.id);
      }

      const opening: MovementInput[] = [];
      for (const row of rows) {
        if (row.opening_stock > 0) {
          opening.push({
            itemId: itemIds.get(row.code)!,
            quantity: row.opening_stock,
            type: 'opening',
            refType: 'import',
          });
        }
      }
      for (const part of batches(opening, BATCH)) {
        await postMovements(tx, { branchId, userId: ctx.user.id, movements: part });
      }

      const result: ImportResult = {
        categoriesCreated: created.length,
        itemsCreated: rows.length,
        openingMovements: opening.length,
      };
      await logAudit(tx, {
        actorId: ctx.user.id,
        branchId,
        action: 'branch.import',
        entity: 'branch',
        entityId: branchId,
        after: result,
        ip,
      });
      return result;
    });
  } catch (error) {
    // The file was checked against the branch before saving, so a duplicate here means another
    // change to the branch's items or categories got in between
    if (isUniqueViolation(error)) {
      throw new AppError(
        'IMPORT_CONFLICT',
        'The branch changed while the file was being imported. Nothing was saved; import the file again',
      );
    }
    throw error;
  }
}

/**
 * Import a CSV file into a branch (the Admin names it, so it must exist). Checks the whole file
 * first: any problem, found anywhere, answers 422 IMPORT_INVALID listing every one, and nothing is
 * saved. A file without problems creates its categories, items and stock rows, and an `opening`
 * ledger row for each item with stock, in one transaction, with one audit row for the import.
 */
export async function importItems(
  db: Db,
  ctx: RequestContext,
  branchId: number,
  csv: string,
  ip: string | null,
): Promise<ImportResult> {
  await requireBranchExists(db, branchId);
  const checked = checkFile(csv);
  await checkAgainstBranch(db, branchId, checked);
  if (checked.problems.list.length > 0) {
    throw new AppError(
      'IMPORT_INVALID',
      'The file has problems; nothing was imported',
      [...checked.problems.list].sort(byPosition),
      422,
    );
  }
  return save(
    db,
    ctx,
    branchId,
    checked.rows.map((entry) => entry.value),
    ip,
  );
}
