import { describe, expect, it } from 'vitest';
import {
  can,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type Role,
} from './permissions.js';

// Copied cell by cell from docs/project-overview.md §3 → Permission matrix.
// If the matrix changes, change this table first — the test then fails until the code agrees.
const MATRIX: ReadonlyArray<[Permission, { cashier: boolean; admin: boolean }]> = [
  ['bill:create', { cashier: true, admin: false }],
  ['bill:read', { cashier: true, admin: false }],
  ['bill:cancel', { cashier: true, admin: false }],
  ['purchase:write', { cashier: true, admin: false }],
  ['purchase:post', { cashier: true, admin: false }],
  ['purchase:cancel', { cashier: true, admin: false }],
  ['item:write', { cashier: true, admin: false }],
  ['category:write', { cashier: true, admin: false }],
  ['vendor:write', { cashier: true, admin: false }],
  ['stock:read', { cashier: true, admin: true }],
  ['stock:adjust', { cashier: true, admin: false }],
  ['report:own-day-summary', { cashier: true, admin: false }],
  ['report:all', { cashier: false, admin: true }],
  ['admin:branches', { cashier: false, admin: true }],
  ['admin:users', { cashier: false, admin: true }],
  ['admin:settings', { cashier: false, admin: true }],
  ['admin:import', { cashier: false, admin: true }],
];

describe('permission matrix (overview §3)', () => {
  it.each(MATRIX)('%s → cashier %o', (permission, expected) => {
    expect(can('cashier', permission)).toBe(expected.cashier);
    expect(can('admin', permission)).toBe(expected.admin);
  });

  it('covers every permission exactly once', () => {
    const inMatrix = MATRIX.map(([permission]) => permission);
    expect(new Set(inMatrix).size).toBe(inMatrix.length);
    expect([...inMatrix].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('has exactly the admin and cashier roles', () => {
    expect([...ROLES].sort()).toEqual(['admin', 'cashier']);
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(['admin', 'cashier']);
  });
});

describe('safety', () => {
  it('denies everything to a role it does not know (e.g. a future role read from the database)', () => {
    for (const permission of PERMISSIONS) {
      expect(can('owner' as Role, permission)).toBe(false);
    }
  });

  it('cannot be changed at runtime', () => {
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    expect(Object.isFrozen(ROLE_PERMISSIONS.cashier)).toBe(true);
    expect(() => (ROLE_PERMISSIONS.admin as Permission[]).push('bill:create')).toThrow();
    expect(can('admin', 'bill:create')).toBe(false);
  });

  it('rejects unknown permission names at compile time', () => {
    // @ts-expect-error — 'bill:delete' is not a permission; check-types fails if this compiles
    const unknown = () => can('cashier', 'bill:delete');
    expect(unknown).toBeTypeOf('function');
  });
});
