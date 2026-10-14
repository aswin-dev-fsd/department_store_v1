import { ROLE_PERMISSIONS } from '@ds/shared';
import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS, visibleSections } from './sections';

describe('ADMIN_SECTIONS', () => {
  it('has a distinct address under /admin for every section', () => {
    const paths = ADMIN_SECTIONS.map((section) => section.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^\/admin\/[a-z]+$/);
  });

  it('asks for the permission the matching API area enforces', () => {
    const permissionOf = Object.fromEntries(
      ADMIN_SECTIONS.map((section) => [section.slug, section.permission]),
    );
    expect(permissionOf).toEqual({
      branches: 'admin:branches',
      users: 'admin:users',
      settings: 'admin:settings',
    });
  });
});

describe('visibleSections', () => {
  it('shows an Admin every section', () => {
    expect(visibleSections(ROLE_PERMISSIONS.admin).map((s) => s.slug)).toEqual([
      'branches',
      'users',
      'settings',
    ]);
  });

  it('shows a cashier none', () => {
    expect(visibleSections(ROLE_PERMISSIONS.cashier)).toEqual([]);
  });

  it('shows only the sections whose permission is held', () => {
    expect(visibleSections(['admin:users']).map((s) => s.slug)).toEqual(['users']);
  });
});
