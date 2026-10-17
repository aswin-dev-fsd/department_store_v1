// Dev task: fill an empty development database with realistic demo data, so later phases can be
// tried by hand (Task 3.8). It runs the real services (setup, branches, users, the CSV import), so
// passwords, audit rows and rules are the real ones. The logic lives here so tests can call it;
// seed-dev.cli.ts is the thin executable.
import { schema, type Db } from '@ds/database';
import { IMPORT_COLUMNS, type CreateBranchInput, type ImportResult } from '@ds/shared';
import { inArray, sql } from 'drizzle-orm';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../middleware/auth.js';
import { changePassword, type SessionUser } from '../modules/auth/auth.service.js';
import { createBranch } from '../modules/branches/branches.service.js';
import { importItems } from '../modules/import/import.service.js';
import { createUser, setUserBranches } from '../modules/users/users.service.js';
import { setupClient } from './setup-client.js';

const DEMO_BUSINESS = 'Demo Department Store';

/** The branch's place in this list also varies its opening stock (see openingStock). */
const BRANCHES: readonly CreateBranchInput[] = [
  {
    code: 'TPR',
    name: 'Tiruppur',
    address: 'Kumaran Road, Tiruppur',
    phone: '0421 2345678',
    billFooter: 'Thank you! Visit again.',
  },
  {
    code: 'CBE',
    name: 'Coimbatore',
    address: 'Avinashi Road, Coimbatore',
    phone: '0422 2345678',
    billFooter: 'Thank you! Visit again.',
  },
];

/**
 * The three accounts and their passwords. The passwords are fixed and public (they are written
 * here and in docs/dev-setup.md): fine for a throwaway dev database, which is the only place the
 * seed runs (see the guards on seedDev). Never reuse them for anything real.
 */
const ADMIN = { username: 'admin', fullName: 'Demo Admin', password: 'admin@123' } as const;

/** One works in a single branch, one in both (to try the branch picker). */
const CASHIERS = [
  {
    username: 'cashier1',
    fullName: 'Demo Cashier (Tiruppur)',
    password: 'cashier1@123',
    branches: ['TPR'],
  },
  {
    username: 'cashier2',
    fullName: 'Demo Cashier (both branches)',
    password: 'cashier2@123',
    branches: ['TPR', 'CBE'],
  },
] as const;

/** [code, name, category, MRP in rupees, selling price in rupees, reorder level in packs] */
export type Product = readonly [
  code: string,
  name: string,
  category: string,
  mrp: number,
  selling: number,
  reorder: number,
];

/** 50 products, 10 in each of 5 categories; every branch sells all of them. */
export const PRODUCTS: readonly Product[] = [
  ['GRC001', 'Basmati rice 5 kg', 'Grocery', 525, 499, 10],
  ['GRC002', 'Sona masoori rice 10 kg', 'Grocery', 640, 599, 8],
  ['GRC003', 'Toor dal 1 kg', 'Grocery', 185, 172, 15],
  ['GRC004', 'Moong dal 1 kg', 'Grocery', 160, 149, 12],
  ['GRC005', 'Sugar 1 kg', 'Grocery', 52, 48, 25],
  ['GRC006', 'Iodised salt 1 kg', 'Grocery', 28, 26, 30],
  ['GRC007', 'Wheat flour (atta) 5 kg', 'Grocery', 265, 249, 12],
  ['GRC008', 'Sunflower oil 1 l', 'Grocery', 165, 152, 20],
  ['GRC009', 'Groundnut oil 1 l', 'Grocery', 230, 215, 10],
  ['GRC010', 'Tamarind 500 g', 'Grocery', 90, 82, 10],
  ['BEV001', 'Tea powder 250 g', 'Beverages', 130, 120, 15],
  ['BEV002', 'Instant coffee 100 g', 'Beverages', 310, 289, 8],
  ['BEV003', 'Cola 2 l', 'Beverages', 95, 90, 20],
  ['BEV004', 'Lemon soda 750 ml', 'Beverages', 40, 38, 24],
  ['BEV005', 'Orange juice 1 l', 'Beverages', 120, 112, 10],
  ['BEV006', 'Mineral water 1 l', 'Beverages', 20, 20, 48],
  ['BEV007', 'Badam milk 200 ml', 'Beverages', 35, 33, 24],
  ['BEV008', 'Green tea (25 bags)', 'Beverages', 175, 160, 10],
  ['BEV009', 'Energy drink 250 ml', 'Beverages', 125, 119, 12],
  ['BEV010', 'Coconut water 200 ml', 'Beverages', 40, 38, 18],
  ['PCR001', 'Bath soap 100 g', 'Personal care', 45, 42, 30],
  ['PCR002', 'Shampoo 180 ml', 'Personal care', 135, 125, 12],
  ['PCR003', 'Toothpaste 150 g', 'Personal care', 95, 89, 20],
  ['PCR004', 'Toothbrush (pack of 2)', 'Personal care', 70, 65, 15],
  ['PCR005', 'Hair oil 200 ml', 'Personal care', 110, 102, 12],
  ['PCR006', 'Face wash 100 ml', 'Personal care', 180, 165, 8],
  ['PCR007', 'Body lotion 250 ml', 'Personal care', 245, 225, 8],
  ['PCR008', 'Deodorant 150 ml', 'Personal care', 210, 195, 8],
  ['PCR009', 'Shaving cream 70 g', 'Personal care', 85, 80, 10],
  ['PCR010', 'Talcum powder 200 g', 'Personal care', 150, 140, 10],
  ['HSE001', 'Detergent powder 1 kg', 'Household', 130, 122, 15],
  ['HSE002', 'Dishwash liquid 500 ml', 'Household', 105, 98, 12],
  ['HSE003', 'Floor cleaner 1 l', 'Household', 190, 175, 8],
  ['HSE004', 'Toilet cleaner 500 ml', 'Household', 100, 94, 10],
  ['HSE005', 'Phenyl 1 l', 'Household', 95, 88, 10],
  ['HSE006', 'Garbage bags (30 pcs)', 'Household', 120, 110, 10],
  ['HSE007', 'Scrub pad (pack of 3)', 'Household', 45, 42, 20],
  ['HSE008', 'Matchbox (pack of 10)', 'Household', 20, 20, 30],
  ['HSE009', 'Mosquito coil (10 coils)', 'Household', 60, 56, 15],
  ['HSE010', 'Candle (pack of 6)', 'Household', 55, 50, 12],
  ['STN001', 'Notebook 200 pages', 'Stationery', 60, 55, 20],
  ['STN002', 'Ball pen (box of 10)', 'Stationery', 100, 90, 15],
  ['STN003', 'Pencil (box of 10)', 'Stationery', 50, 45, 15],
  ['STN004', 'Eraser (pack of 5)', 'Stationery', 25, 22, 20],
  ['STN005', 'Geometry box', 'Stationery', 140, 130, 6],
  ['STN006', 'Drawing book', 'Stationery', 45, 42, 15],
  ['STN007', 'Sticky notes', 'Stationery', 80, 72, 10],
  ['STN008', 'Glue stick', 'Stationery', 30, 28, 20],
  ['STN009', 'Marker pens (set of 4)', 'Stationery', 90, 82, 10],
  ['STN010', 'A4 paper (500 sheets)', 'Stationery', 380, 355, 5],
];

/** An EAN-13 barcode: the 12 digits given, then their check digit. */
export function ean13(body: string): string {
  const sum = [...body].reduce(
    (total, digit, place) => total + Number(digit) * (place % 2 === 0 ? 1 : 3),
    0,
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** The demo barcode of the product at `index`: the Indian 890 prefix, then a running number. */
export function barcodeOf(index: number): string {
  return ean13(`8901${String(index + 1).padStart(8, '0')}`);
}

/**
 * Opening stock of the product at `index` in the branch at `branchIndex`: a spread of 50 to 99
 * packs (above every reorder level), with a few items sold out (0) and a few below their reorder
 * level (3), different in each branch, so billing and low-stock screens have something to show.
 * The same on every run.
 */
export function openingStock(index: number, branchIndex: number): number {
  if ((index + branchIndex * 4) % 17 === 5) return 0;
  if ((index + branchIndex * 6) % 13 === 3) return 3;
  return 50 + ((index * 7 + branchIndex * 11) % 50);
}

/** The CSV file the import takes for the branch at `branchIndex`: all 50 products with prices and stock. */
export function catalogCsv(branchIndex: number): string {
  const rows = PRODUCTS.map(([code, name, category, mrp, selling, reorder], index) =>
    [
      code,
      barcodeOf(index),
      name,
      category,
      mrp.toFixed(2),
      selling.toFixed(2),
      reorder,
      openingStock(index, branchIndex),
    ].join(','),
  );
  return `${[IMPORT_COLUMNS.join(','), ...rows].join('\n')}\n`;
}

export interface SeededAccount {
  username: string;
  fullName: string;
  role: 'admin' | 'cashier';
  /** Codes of the branches the account works in; none for the Admin. */
  branches: string[];
  /** The fixed dev password (public, see ADMIN); no change is forced at the first login. */
  password: string;
}

export type SeededBranch = { code: string; name: string } & ImportResult;

export type SeedResult =
  | { status: 'already-seeded' }
  | { status: 'seeded'; accounts: SeededAccount[]; branches: SeededBranch[] };

export interface SeedOptions {
  /** The process's NODE_ENV: the seed never runs in production. */
  nodeEnv: string;
}

/** A caller as the services see one; the session fields only matter for HTTP requests. */
function asCaller(user: SessionUser): RequestContext {
  return { user, activeBranchId: null, sessionId: 0, sessionToken: '' };
}

/**
 * The password change a person makes at the first login, made for them: the generated temporary
 * password is replaced by the fixed dev one through the real change-password service, so it is
 * hashed and audited like any other, and no change is forced at login.
 */
async function chooseDevPassword(
  db: Db,
  caller: RequestContext,
  temporaryPassword: string,
  password: string,
): Promise<void> {
  await changePassword(
    db,
    caller,
    { currentPassword: temporaryPassword, newPassword: password },
    null,
  );
}

/** Whether the database holds anything the seed would collide with: a user, the settings or a branch. */
async function hasData(db: Db): Promise<boolean> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select (select count(*)::int from users)
             + (select count(*)::int from client_settings)
             + (select count(*)::int from branches) as n`,
  );
  return Number(rows[0]?.n) > 0;
}

/**
 * Fill an empty database with demo data: the client settings, an Admin and two cashiers with fixed
 * dev passwords, the branches TPR and CBE, and in each branch 5 categories and 50 items with
 * barcodes, prices and opening stock (through the CSV import, so the stock ledger is filled the
 * real way).
 *
 * - Refuses in production, changing nothing.
 * - When both seed branches already exist, answers `already-seeded` and changes nothing.
 * - Refuses a database that has other data, changing nothing.
 * - Runs as several transactions, one per service call; if it stops half-way, empty the database
 *   and run it again.
 */
export async function seedDev(db: Db, { nodeEnv }: SeedOptions): Promise<SeedResult> {
  if (nodeEnv === 'production') {
    throw new AppError(
      'SEED_REFUSED',
      'The dev seed never runs in production (NODE_ENV=production). Nothing was changed.',
    );
  }
  const present = await db
    .select({ code: schema.branches.code })
    .from(schema.branches)
    .where(
      inArray(
        schema.branches.code,
        BRANCHES.map((branch) => branch.code),
      ),
    );
  if (present.length === BRANCHES.length) {
    return { status: 'already-seeded' };
  }
  if (await hasData(db)) {
    throw new AppError(
      'NOT_EMPTY',
      'This database already has data that the dev seed did not create (a user, the client settings or a branch). The seed fills an empty database only. Nothing was changed.',
    );
  }

  const setup = await setupClient(db, {
    businessName: DEMO_BUSINESS,
    adminUsername: ADMIN.username,
    adminFullName: ADMIN.fullName,
  });
  const adminUser: SessionUser = { ...setup.admin, role: 'admin', mustChangePassword: true };
  await chooseDevPassword(db, asCaller(adminUser), setup.temporaryPassword, ADMIN.password);
  const admin = asCaller({ ...adminUser, mustChangePassword: false });

  const branchIds = new Map<string, number>();
  for (const input of BRANCHES) {
    const branch = await createBranch(db, admin, input, null);
    branchIds.set(branch.code, branch.id);
  }

  const accounts: SeededAccount[] = [
    {
      username: setup.admin.username,
      fullName: setup.admin.fullName,
      role: 'admin',
      branches: [],
      password: ADMIN.password,
    },
  ];
  for (const cashier of CASHIERS) {
    const created = await createUser(
      db,
      admin,
      { username: cashier.username, fullName: cashier.fullName, role: 'cashier' },
      null,
    );
    await setUserBranches(
      db,
      admin,
      created.user.id,
      { branchIds: cashier.branches.map((code) => branchIds.get(code)!) },
      null,
    );
    const { id, username, fullName } = created.user;
    await chooseDevPassword(
      db,
      asCaller({ id, username, fullName, role: 'cashier', mustChangePassword: true }),
      created.temporaryPassword,
      cashier.password,
    );
    accounts.push({
      username,
      fullName,
      role: 'cashier',
      branches: [...cashier.branches],
      password: cashier.password,
    });
  }

  const branches: SeededBranch[] = [];
  for (const [index, input] of BRANCHES.entries()) {
    const imported = await importItems(
      db,
      admin,
      branchIds.get(input.code)!,
      catalogCsv(index),
      null,
    );
    branches.push({ code: input.code, name: input.name, ...imported });
  }
  return { status: 'seeded', accounts, branches };
}
