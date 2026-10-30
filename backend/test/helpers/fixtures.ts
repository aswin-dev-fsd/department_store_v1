// Test data builders: use these instead of writing INSERTs in every test (AGENTS.md → Workflow).
// They write straight to the test database, bypassing the API, so a test can set up any state
// quickly (a user with a session, a branch, a mapping) without depending on other routes.
import type { Db, DbHandle } from '@ds/database';
import { SESSION_COOKIE } from '../../src/middleware/auth.js';
import { createSession } from '../../src/modules/auth/auth.service.js';

type Pool = DbHandle['pool'];

let counter = 0;
const next = () => ++counter;

/** "A", "B", … "Z", "AA", … — a valid branch code for any counter value up to 702. */
function codeFor(n: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    code = letters[(rest - 1) % 26]! + code;
  }
  return code;
}

export interface UserFixture {
  username?: string;
  fullName?: string;
  role?: 'admin' | 'cashier';
  isActive?: boolean;
  mustChangePassword?: boolean;
}

/** Insert a user (default: an active cashier) and return its id. Its password hash is a dummy: log in with cookieFor. */
export async function createUser(pool: Pool, options: UserFixture = {}): Promise<number> {
  const username = options.username ?? `user${next()}`;
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (username, password_hash, full_name, role, is_active, must_change_password)
     values ($1, 'x', $2, $3, $4, $5) returning id`,
    [
      username,
      options.fullName ?? `Full ${username}`,
      options.role ?? 'cashier',
      options.isActive ?? true,
      options.mustChangePassword ?? false,
    ],
  );
  return Number(rows[0]!.id);
}

export interface BranchFixture {
  code?: string;
  name?: string;
  address?: string;
  isActive?: boolean;
}

/** Insert a branch (default: active, with a unique code) and return its id. */
export async function createBranch(pool: Pool, options: BranchFixture = {}): Promise<number> {
  const code = options.code ?? codeFor(next());
  const { rows } = await pool.query<{ id: string }>(
    `insert into branches (code, name, address, is_active) values ($1, $2, $3, $4) returning id`,
    [
      code,
      options.name ?? `Branch ${code}`,
      options.address ?? `${code} Main Road`,
      options.isActive ?? true,
    ],
  );
  return Number(rows[0]!.id);
}

/** Insert a category for a branch and return its id. */
export async function createCategory(pool: Pool, branchId: number, name: string): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    'insert into categories (branch_id, name) values ($1, $2) returning id',
    [branchId, name],
  );
  return Number(rows[0]!.id);
}

export interface ItemFixture {
  code?: string;
  name?: string;
  barcode?: string | null;
  mrpPaise?: number;
  sellingPricePaise?: number;
  isActive?: boolean;
  /** A category of the same branch; none by default. */
  categoryId?: number | null;
  /** In packs; none (no low-stock warning) by default. */
  reorderLevel?: number | null;
}

/**
 * Insert an item with its item_stock row at 0, as the Items API does, and return its id.
 * Give it stock through the ledger (see helpers/ledger.ts), never by editing item_stock.
 */
export async function createItem(
  pool: Pool,
  branchId: number,
  options: ItemFixture = {},
): Promise<number> {
  const n = next();
  const { rows } = await pool.query<{ id: string }>(
    `insert into items (branch_id, code, barcode, name, mrp_paise, selling_price_paise, is_active,
                        category_id, reorder_level)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      branchId,
      options.code ?? `ITEM${n}`,
      options.barcode ?? null,
      options.name ?? `Item ${n}`,
      options.mrpPaise ?? 10000,
      options.sellingPricePaise ?? 9000,
      options.isActive ?? true,
      options.categoryId ?? null,
      options.reorderLevel ?? null,
    ],
  );
  const id = Number(rows[0]!.id);
  await pool.query('insert into item_stock (item_id, quantity) values ($1, 0)', [id]);
  return id;
}

export interface VendorFixture {
  name?: string;
  phone?: string | null;
  address?: string | null;
  gstin?: string | null;
  isActive?: boolean;
}

/** Insert a vendor for a branch (default: active, with no phone, address or GSTIN) and return its id. */
export async function createVendor(
  pool: Pool,
  branchId: number,
  options: VendorFixture = {},
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into vendors (branch_id, name, phone, address, gstin, is_active)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      branchId,
      options.name ?? `Vendor ${next()}`,
      options.phone ?? null,
      options.address ?? null,
      options.gstin ?? null,
      options.isActive ?? true,
    ],
  );
  return Number(rows[0]!.id);
}

/** Map a cashier to a branch. */
export async function mapUser(pool: Pool, userId: number, branchId: number): Promise<void> {
  await pool.query('insert into user_branches (user_id, branch_id) values ($1, $2)', [
    userId,
    branchId,
  ]);
}

export interface ClientSettingsFixture {
  businessName?: string;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
}

/** Insert the single client_settings row. */
export async function createClientSettings(
  pool: Pool,
  options: ClientSettingsFixture = {},
): Promise<void> {
  await pool.query(
    `insert into client_settings (id, business_name, address, phone, gstin) values (1, $1, $2, $3, $4)`,
    [
      options.businessName ?? 'Demo Stores',
      options.address ?? null,
      options.phone ?? null,
      options.gstin ?? null,
    ],
  );
}

/** Start a session for a user and return the `Cookie` header value to send with requests. */
export async function cookieFor(
  db: Db,
  userId: number,
  activeBranchId: number | null = null,
): Promise<string> {
  const { token } = await createSession(db, { userId, activeBranchId });
  return `${SESSION_COOKIE}=${token}`;
}
