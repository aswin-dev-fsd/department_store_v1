// User management (Admin): create, list, edit, deactivate, reset a password, assign branches.
// Every change is audited in the same transaction (D-30). Passwords are never returned except
// the one-time temporary password of a new or reset account, and never written to the audit log.
import type { Db } from '@ds/database';
import type {
  CreatedUser,
  CreateUserInput,
  ListUsersQuery,
  Page,
  PasswordReset,
  SetUserBranchesInput,
  UpdateUserInput,
  UserBranch,
  UserSummary,
} from '@ds/shared';
import { logAudit } from '../../lib/audit.js';
import { changedFields } from '../../lib/changes.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { generateTemporaryPassword } from '../../lib/temporary-password.js';
import type { RequestContext } from '../../middleware/auth.js';
import { deleteUserSessions, hashPassword } from '../auth/auth.service.js';
import * as model from './users.model.js';
import type { UserRow } from './users.model.js';

function toUserSummary(row: UserRow, branches: UserBranch[]): UserSummary {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt === null ? null : row.lastLoginAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    branches,
  };
}

async function branchesOf(db: Parameters<typeof model.listBranchesForUsers>[0], userId: number) {
  return (await model.listBranchesForUsers(db, [userId])).get(userId) ?? [];
}

/** What an audit row records about a user's branches: ids (stable) and codes (readable). */
function branchSnapshot(branches: UserBranch[]) {
  return {
    branchIds: branches.map((branch) => branch.id).sort((a, b) => a - b),
    branchCodes: branches.map((branch) => branch.code),
  };
}

/** One page of users, with their branches. */
export async function listUsers(db: Db, query: ListUsersQuery): Promise<Page<UserSummary>> {
  const { rows, total } = await model.listUsers(db, query);
  const branches = await model.listBranchesForUsers(
    db,
    rows.map((row) => row.id),
  );
  return {
    items: rows.map((row) => toUserSummary(row, branches.get(row.id) ?? [])),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

/**
 * Create a user with a one-time temporary password that must be changed at first login. A
 * username that is taken (in any letter case) answers DUPLICATE_USERNAME, even when two
 * creates race.
 */
export async function createUser(
  db: Db,
  ctx: RequestContext,
  input: CreateUserInput,
  ip: string | null,
): Promise<CreatedUser> {
  const temporaryPassword = generateTemporaryPassword();
  // Before the transaction: bcrypt is deliberately slow and shouldn't hold a connection open
  const passwordHash = await hashPassword(temporaryPassword);

  return db.transaction(async (tx) => {
    const row = await model.insertUserIfUsernameFree(tx, {
      username: input.username,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
      mustChangePassword: true,
    });
    if (!row) {
      throw new AppError('DUPLICATE_USERNAME', 'That username is already taken');
    }
    await logAudit(tx, {
      actorId: ctx.user.id,
      action: 'user.create',
      entity: 'user',
      entityId: row.id,
      after: {
        username: row.username,
        fullName: row.fullName,
        role: row.role,
        isActive: row.isActive,
        mustChangePassword: row.mustChangePassword,
      },
      ip,
    });
    return { user: toUserSummary(row, []), temporaryPassword };
  });
}

/**
 * Edit a user's name, or deactivate / reactivate the account. Deactivating ends all their
 * sessions at once. You cannot deactivate yourself, which also means at least one active Admin
 * always remains. Only fields that really change are written and audited.
 */
export async function updateUser(
  db: Db,
  ctx: RequestContext,
  id: number,
  patch: UpdateUserInput,
  ip: string | null,
): Promise<UserSummary> {
  return db.transaction(async (tx) => {
    const current = await model.findUserForUpdate(tx, id);
    if (!current) {
      throw new NotFoundError('User not found');
    }
    if (patch.isActive === false && id === ctx.user.id) {
      throw new AppError('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
    }
    const branches = await branchesOf(tx, id);
    const changes = changedFields(
      { fullName: current.fullName, isActive: current.isActive },
      patch,
    );
    if (!changes) {
      return toUserSummary(current, branches);
    }

    const updated = await model.updateUser(tx, id, changes.after);
    if (changes.after.isActive === false) {
      await deleteUserSessions(tx, id);
    }
    const action =
      changes.after.isActive === undefined
        ? 'user.update'
        : changes.after.isActive
          ? 'user.activate'
          : 'user.deactivate';
    await logAudit(tx, {
      actorId: ctx.user.id,
      action,
      entity: 'user',
      entityId: id,
      before: changes.before,
      after: changes.after,
      ip,
    });
    return toUserSummary(updated, branches);
  });
}

/**
 * Give a user a new one-time temporary password that must be changed at next login, and end
 * all their sessions. Shared by the Admin API and the reset-password command; `actorId` is null
 * when an operator runs the command. The password is returned, never stored or audited.
 */
export async function resetUserPassword(
  db: Db,
  userId: number,
  actorId: number | null,
  ip: string | null,
): Promise<PasswordReset> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  return db.transaction(async (tx) => {
    const current = await model.findUserForUpdate(tx, userId);
    if (!current) {
      throw new NotFoundError('User not found');
    }
    await model.setTemporaryPassword(tx, userId, passwordHash);
    const sessionsEnded = await deleteUserSessions(tx, userId);
    await logAudit(tx, {
      actorId,
      action: 'user.reset_password',
      entity: 'user',
      entityId: userId,
      before: { mustChangePassword: current.mustChangePassword },
      after: { mustChangePassword: true, sessionsEnded },
      ip,
    });
    return { temporaryPassword };
  });
}

/** An Admin resets someone else's password. Your own goes through "change password". */
export async function resetPassword(
  db: Db,
  ctx: RequestContext,
  id: number,
  ip: string | null,
): Promise<PasswordReset> {
  if (id === ctx.user.id) {
    throw new AppError('CANNOT_RESET_OWN_PASSWORD', 'Use "Change password" for your own account');
  }
  return resetUserPassword(db, id, ctx.user.id, ip);
}

/**
 * Replace the whole list of branches a cashier may work in. Only cashiers have branches. A
 * branch can only be *added* if it exists and is active; one that is already mapped may stay
 * even if it has since been deactivated, so a list can be saved again unchanged. A cashier
 * working in a removed branch loses it on their next request. Writes nothing if the set is the same.
 */
export async function setUserBranches(
  db: Db,
  ctx: RequestContext,
  id: number,
  input: SetUserBranchesInput,
  ip: string | null,
): Promise<UserSummary> {
  const requested = [...new Set(input.branchIds)].sort((a, b) => a - b);

  return db.transaction(async (tx) => {
    const user = await model.findUserForUpdate(tx, id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    if (user.role !== 'cashier') {
      throw new AppError('NOT_A_CASHIER', 'Only cashiers are assigned to branches');
    }

    const existing = await branchesOf(tx, id);
    const existingIds = new Set(existing.map((branch) => branch.id));
    const toAdd = requested.filter((branchId) => !existingIds.has(branchId));
    const toRemove = [...existingIds].filter((branchId) => !requested.includes(branchId));

    if (toAdd.length > 0) {
      const found = await model.findBranchesByIds(tx, toAdd);
      const usable = new Set(found.filter((branch) => branch.isActive).map((branch) => branch.id));
      const unavailable = toAdd.filter((branchId) => !usable.has(branchId));
      if (unavailable.length > 0) {
        throw new AppError(
          'BRANCH_NOT_AVAILABLE',
          'Some of those branches do not exist or are not active',
          { branchIds: unavailable },
        );
      }
    }
    if (toAdd.length === 0 && toRemove.length === 0) {
      return toUserSummary(user, existing);
    }

    await model.deleteMappings(tx, id, toRemove);
    await model.insertMappings(tx, id, toAdd);
    const after = await branchesOf(tx, id);
    await logAudit(tx, {
      actorId: ctx.user.id,
      action: 'user.branches_update',
      entity: 'user',
      entityId: id,
      before: branchSnapshot(existing),
      after: branchSnapshot(after),
      ip,
    });
    return toUserSummary(user, after);
  });
}
