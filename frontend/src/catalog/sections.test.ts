import { ROLE_PERMISSIONS } from '@ds/shared';
import { describe, expect, it } from 'vitest';
import { CATALOG_SECTIONS, visibleCatalogSections } from './sections';

describe('CATALOG_SECTIONS', () => {
  it('has a distinct address under /catalog for every section', () => {
    const paths = CATALOG_SECTIONS.map((section) => section.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^\/catalog\/[a-z]+$/);
  });

  it('asks for the permission the matching API area enforces', () => {
    const permissionOf = Object.fromEntries(
      CATALOG_SECTIONS.map((section) => [section.slug, section.permission]),
    );
    expect(permissionOf).toEqual({
      items: 'item:write',
      categories: 'category:write',
      vendors: 'vendor:write',
    });
  });
});

describe('visibleCatalogSections', () => {
  it('shows a cashier every section', () => {
    expect(visibleCatalogSections(ROLE_PERMISSIONS.cashier).map((s) => s.slug)).toEqual([
      'items',
      'categories',
      'vendors',
    ]);
  });

  it('shows an Admin none: the Admin does not maintain the catalog by hand', () => {
    expect(visibleCatalogSections(ROLE_PERMISSIONS.admin)).toEqual([]);
  });

  it('shows only the sections whose permission is held', () => {
    expect(visibleCatalogSections(['vendor:write']).map((s) => s.slug)).toEqual(['vendors']);
  });
});
