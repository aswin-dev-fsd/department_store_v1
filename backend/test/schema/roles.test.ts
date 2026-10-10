import { schema } from '@ds/database';
import { ROLE_PERMISSIONS, ROLES } from '@ds/shared';
import { describe, expect, it } from 'vitest';

// The permission map (shared) and the database enum (database) are defined separately;
// this keeps them from drifting apart when a role such as Owner is added (FP-03).
describe('roles', () => {
  it('match the database user_role enum exactly', () => {
    expect([...schema.userRole.enumValues].sort()).toEqual([...ROLES].sort());
  });

  it('each have an entry in the permission map', () => {
    for (const role of schema.userRole.enumValues) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });
});
