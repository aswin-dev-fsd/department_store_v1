import type { BranchSummary, UserBranch } from '@ds/shared';

export interface BranchChoice {
  id: number;
  code: string;
  name: string;
  /** A branch the user is still mapped to but that has been deactivated; it can only be removed. */
  inactive: boolean;
  checked: boolean;
}

/**
 * The checklist for mapping a cashier to branches: every active branch, plus any branch the
 * cashier is already mapped to (an inactive one stays visible so it can be unticked), once
 * each and ordered by code.
 */
export function branchChoices(
  active: readonly BranchSummary[],
  mapped: readonly UserBranch[],
  selected: readonly number[],
): BranchChoice[] {
  const picked = new Set(selected);
  const choices = new Map<number, BranchChoice>();
  for (const branch of active) {
    choices.set(branch.id, { ...summary(branch), inactive: false, checked: picked.has(branch.id) });
  }
  for (const branch of mapped) {
    if (choices.has(branch.id)) continue;
    choices.set(branch.id, {
      ...summary(branch),
      inactive: !branch.isActive,
      checked: picked.has(branch.id),
    });
  }
  return [...choices.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function summary({ id, code, name }: BranchSummary) {
  return { id, code, name };
}

/** The selection with `id` added or removed, as a new list ordered by id. */
export function toggleBranch(selected: readonly number[], id: number): number[] {
  const next = selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id];
  return next.sort((a, b) => a - b);
}

/** Whether the selection differs from what the cashier is mapped to now, ignoring order. */
export function hasChanged(mapped: readonly UserBranch[], selected: readonly number[]): boolean {
  const before = new Set(mapped.map((branch) => branch.id));
  const after = new Set(selected);
  return before.size !== after.size || [...before].some((id) => !after.has(id));
}
