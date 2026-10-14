import type { BranchSummary, UserBranch } from '@ds/shared';
import { describe, expect, it } from 'vitest';
import { branchChoices, hasChanged, toggleBranch } from './branchChoices';

const tpr: BranchSummary = { id: 1, code: 'TPR', name: 'Tiruppur' };
const cbe: BranchSummary = { id: 2, code: 'CBE', name: 'Coimbatore' };
const erd: BranchSummary = { id: 3, code: 'ERD', name: 'Erode' };
const mapped = (branch: BranchSummary, isActive = true): UserBranch => ({ ...branch, isActive });

describe('branchChoices', () => {
  it('lists every active branch, ordered by code, with the selected ones checked', () => {
    const choices = branchChoices([tpr, cbe, erd], [], [2]);
    expect(choices.map((c) => [c.code, c.checked, c.inactive])).toEqual([
      ['CBE', true, false],
      ['ERD', false, false],
      ['TPR', false, false],
    ]);
  });

  it('keeps an inactive branch the user is mapped to, flagged, so it can be removed', () => {
    const choices = branchChoices([tpr], [mapped(erd, false)], [3]);
    expect(choices.map((c) => [c.code, c.checked, c.inactive])).toEqual([
      ['ERD', true, true],
      ['TPR', false, false],
    ]);
  });

  it('shows each branch once when it is both active and mapped', () => {
    const choices = branchChoices([tpr, cbe], [mapped(tpr)], [1]);
    expect(choices.filter((c) => c.id === 1)).toHaveLength(1);
    expect(choices).toHaveLength(2);
  });

  it('does not list an inactive branch the user is not mapped to', () => {
    // inactive branches never come in with the active list, and unmapped ones are not offered
    expect(branchChoices([tpr], [], [])).toHaveLength(1);
  });

  it('lets an inactive branch be unchecked (removed) like any other', () => {
    const choices = branchChoices([tpr], [mapped(erd, false)], []);
    expect(choices.find((c) => c.id === 3)).toMatchObject({ checked: false, inactive: true });
  });
});

describe('toggleBranch', () => {
  it('adds a branch that is not selected, keeping the list ordered by id', () => {
    expect(toggleBranch([3, 1], 2)).toEqual([1, 2, 3]);
  });

  it('removes a branch that is selected', () => {
    expect(toggleBranch([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it('does not change the list it was given', () => {
    const selected = [1, 2];
    toggleBranch(selected, 3);
    expect(selected).toEqual([1, 2]);
  });
});

describe('hasChanged', () => {
  it('is false when the same branches are selected, in any order', () => {
    expect(hasChanged([mapped(tpr), mapped(cbe)], [2, 1])).toBe(false);
  });

  it('is true when one was added, removed or swapped', () => {
    expect(hasChanged([mapped(tpr)], [1, 2])).toBe(true);
    expect(hasChanged([mapped(tpr), mapped(cbe)], [1])).toBe(true);
    expect(hasChanged([mapped(tpr)], [2])).toBe(true);
  });

  it('treats no mapping and no selection as unchanged', () => {
    expect(hasChanged([], [])).toBe(false);
  });
});
