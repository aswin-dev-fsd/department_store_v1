import type { Branch, ClientSettings, Role } from '@ds/shared';

// Form state is always text, so every input stays controlled. The shared zod schemas turn it
// into API input on submit (trimming, upper-casing a code, blank optional values → null).

export interface BranchFormValues {
  code: string;
  name: string;
  address: string;
  phone: string;
  billFooter: string;
}

export const EMPTY_BRANCH_FORM: BranchFormValues = {
  code: '',
  name: '',
  address: '',
  phone: '',
  billFooter: '',
};

/** The edit form's starting values for a branch. */
export function branchToForm(branch: Branch): BranchFormValues {
  return {
    code: branch.code,
    name: branch.name,
    address: branch.address,
    phone: branch.phone ?? '',
    billFooter: branch.billFooter ?? '',
  };
}

export interface SettingsFormValues {
  businessName: string;
  address: string;
  phone: string;
}

/** The settings form's starting values. */
export function settingsToForm(settings: ClientSettings): SettingsFormValues {
  return {
    businessName: settings.businessName,
    address: settings.address ?? '',
    phone: settings.phone ?? '',
  };
}

export interface UserFormValues {
  username: string;
  fullName: string;
  role: Role;
}

/** New accounts are cashiers unless the Admin says otherwise: the common case. */
export const EMPTY_USER_FORM: UserFormValues = { username: '', fullName: '', role: 'cashier' };
