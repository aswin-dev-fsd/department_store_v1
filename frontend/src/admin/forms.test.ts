import type { Branch, ClientSettings } from '@ds/shared';
import {
  createBranchSchema,
  createUserSchema,
  updateBranchSchema,
  updateSettingsSchema,
} from '@ds/shared';
import { describe, expect, it } from 'vitest';
import { validateForm } from '../forms/fieldErrors';
import { branchToForm, EMPTY_BRANCH_FORM, EMPTY_USER_FORM, settingsToForm } from './forms';

const branch: Branch = {
  id: 1,
  code: 'TPR',
  name: 'Tiruppur',
  address: '12 Main Road',
  phone: null,
  billFooter: null,
  isActive: true,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
};

describe('branchToForm', () => {
  it('turns missing optional values into empty text so inputs stay controlled', () => {
    expect(branchToForm(branch)).toEqual({
      code: 'TPR',
      name: 'Tiruppur',
      address: '12 Main Road',
      phone: '',
      billFooter: '',
    });
  });

  it('keeps optional values that exist', () => {
    expect(branchToForm({ ...branch, phone: '0421 100', billFooter: 'Thank you' })).toMatchObject({
      phone: '0421 100',
      billFooter: 'Thank you',
    });
  });
});

describe('settingsToForm', () => {
  const settings: ClientSettings = {
    businessName: 'Demo Stores',
    address: null,
    phone: '0421 100',
    updatedAt: '2026-10-10T00:00:00.000Z',
  };

  it('maps the record to text fields, empty for missing values', () => {
    expect(settingsToForm(settings)).toEqual({
      businessName: 'Demo Stores',
      address: '',
      phone: '0421 100',
    });
  });
});

describe('empty forms against the shared schemas (what the server will apply)', () => {
  it('an empty branch form fails on the required fields only', () => {
    const result = validateForm(createBranchSchema, EMPTY_BRANCH_FORM);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['address', 'code', 'name']);
  });

  it('a filled branch form is accepted; the code is upper-cased and blanks become null', () => {
    const result = validateForm(createBranchSchema, {
      code: ' tp ',
      name: 'Tiruppur',
      address: '12 Main Road',
      phone: '',
      billFooter: '',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        code: 'TP',
        name: 'Tiruppur',
        address: '12 Main Road',
        phone: null,
        billFooter: null,
      },
    });
  });

  it('an edited branch form is accepted by the update schema', () => {
    expect(validateForm(updateBranchSchema, branchToForm(branch)).ok).toBe(true);
  });

  it('a cleared required field on edit is refused', () => {
    const result = validateForm(updateBranchSchema, { ...branchToForm(branch), name: ' ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveProperty('name');
  });

  it('an empty user form fails on username and full name, and starts as a cashier', () => {
    expect(EMPTY_USER_FORM.role).toBe('cashier');
    const result = validateForm(createUserSchema, EMPTY_USER_FORM);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['fullName', 'username']);
  });

  it('a settings form needs a business name and nothing else', () => {
    expect(
      validateForm(updateSettingsSchema, { businessName: '', address: '', phone: '' }).ok,
    ).toBe(false);
    expect(
      validateForm(updateSettingsSchema, { businessName: 'Demo Stores', address: '', phone: '' }),
    ).toEqual({ ok: true, data: { businessName: 'Demo Stores', address: null, phone: null } });
  });
});
