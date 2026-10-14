import { ROLE_PERMISSIONS, type MeResponse } from '@ds/shared';

const branchA = { id: 1, code: 'TPR', name: 'Tiruppur' };
const branchB = { id: 2, code: 'CBE', name: 'Coimbatore' };

/** An Admin who is logged in and has nothing pending. */
export function adminMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: {
      id: 1,
      username: 'admin',
      fullName: 'Store Admin',
      role: 'admin',
      mustChangePassword: false,
    },
    permissions: [...ROLE_PERMISSIONS.admin],
    branches: [],
    activeBranchId: null,
    needsBranchSelection: false,
    ...overrides,
  };
}

/** A Cashier with one branch, already working in it. */
export function cashierMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: {
      id: 2,
      username: 'ravi',
      fullName: 'Ravi Kumar',
      role: 'cashier',
      mustChangePassword: false,
    },
    permissions: [...ROLE_PERMISSIONS.cashier],
    branches: [branchA],
    activeBranchId: branchA.id,
    needsBranchSelection: false,
    ...overrides,
  };
}

/** A Cashier with two branches who has not picked one yet. */
export function twoBranchCashierMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return cashierMe({
    branches: [branchA, branchB],
    activeBranchId: null,
    needsBranchSelection: true,
    ...overrides,
  });
}

/** Copy of `me` whose user must replace a temporary password. */
export function withPasswordChangeDue(me: MeResponse): MeResponse {
  return { ...me, user: { ...me.user, mustChangePassword: true } };
}
