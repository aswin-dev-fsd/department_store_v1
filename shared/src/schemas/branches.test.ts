import { describe, expect, it } from 'vitest';
import {
  branchCodeSchema,
  createBranchSchema,
  listBranchesQuerySchema,
  updateBranchSchema,
} from './branches.js';

describe('branchCodeSchema', () => {
  it('trims and upper-cases, so "tpr" is accepted as TPR', () => {
    expect(branchCodeSchema.parse(' tpr ')).toBe('TPR');
  });

  it.each(['A', 'CB', 'TPR'])('accepts %j', (code) => {
    expect(branchCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each([['TPRX'], ['T1'], ['T R'], ['T-R'], [''], ['   '], ['ட']])('refuses %j', (code) => {
    expect(branchCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe('createBranchSchema', () => {
  const valid = { code: 'TPR', name: 'Tiruppur', address: '12 Main Road' };

  it('needs a code, name and address; phone and bill footer are optional', () => {
    expect(createBranchSchema.parse(valid)).toEqual(valid);
    expect(createBranchSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false);
    expect(createBranchSchema.safeParse({ ...valid, address: '' }).success).toBe(false);
    expect(createBranchSchema.safeParse({ name: 'x', address: 'y' }).success).toBe(false);
  });

  it('keeps Tamil text and multi-line bill footers; blank optional fields become null', () => {
    expect(
      createBranchSchema.parse({
        ...valid,
        name: 'கோவை கிளை',
        phone: '  ',
        billFooter: 'நன்றி\nமீண்டும் வருக',
      }),
    ).toMatchObject({ name: 'கோவை கிளை', phone: null, billFooter: 'நன்றி\nமீண்டும் வருக' });
  });

  it('limits lengths: name 100, address 200, phone 20, bill footer 300', () => {
    expect(createBranchSchema.safeParse({ ...valid, name: 'a'.repeat(101) }).success).toBe(false);
    expect(createBranchSchema.safeParse({ ...valid, address: 'a'.repeat(201) }).success).toBe(
      false,
    );
    expect(createBranchSchema.safeParse({ ...valid, phone: '1'.repeat(21) }).success).toBe(false);
    expect(createBranchSchema.safeParse({ ...valid, billFooter: 'a'.repeat(301) }).success).toBe(
      false,
    );
  });
});

describe('updateBranchSchema', () => {
  it('accepts any single field, including isActive', () => {
    expect(updateBranchSchema.parse({ name: ' New ' })).toEqual({ name: 'New' });
    expect(updateBranchSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateBranchSchema.parse({ code: 'cbe' })).toEqual({ code: 'CBE' });
  });

  it('lets a phone or bill footer be cleared with null or an empty string', () => {
    expect(updateBranchSchema.parse({ phone: null })).toEqual({ phone: null });
    expect(updateBranchSchema.parse({ billFooter: '' })).toEqual({ billFooter: null });
  });

  it('refuses an empty body', () => {
    const result = updateBranchSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/at least one field/i);
  });

  it('refuses blank required fields and a non-boolean isActive', () => {
    expect(updateBranchSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(updateBranchSchema.safeParse({ address: '' }).success).toBe(false);
    expect(updateBranchSchema.safeParse({ isActive: 'false' }).success).toBe(false);
  });
});

describe('listBranchesQuerySchema', () => {
  it('has paging defaults and an optional isActive filter read from text', () => {
    expect(listBranchesQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(listBranchesQuerySchema.parse({ isActive: 'true' }).isActive).toBe(true);
    expect(listBranchesQuerySchema.parse({ isActive: 'false' }).isActive).toBe(false);
    expect(listBranchesQuerySchema.safeParse({ isActive: 'maybe' }).success).toBe(false);
  });
});
