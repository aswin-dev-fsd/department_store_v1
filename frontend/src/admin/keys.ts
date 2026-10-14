// Query keys for the Admin screens. All start with 'admin', so one prefix names a whole area,
// and none start with an auth key, so logging out or switching user clears them (auth/cache.ts).
export const adminKeys = {
  /** Every branch query: lists and the checklist options. */
  branches: ['admin', 'branches'] as const,
  branchList: (limit: number, offset: number) =>
    ['admin', 'branches', 'list', { limit, offset }] as const,
  /** Active branches for the cashier-mapping checklist. */
  branchOptions: ['admin', 'branches', 'options'] as const,
  users: ['admin', 'users'] as const,
  userList: (limit: number, offset: number) =>
    ['admin', 'users', 'list', { limit, offset }] as const,
  settings: ['admin', 'settings'] as const,
};
