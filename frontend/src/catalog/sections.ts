import type { Permission } from '@ds/shared';
import type { MessageKey } from '../i18n/en';

export interface CatalogSection {
  /** Last part of the address: the section lives at /catalog/<slug>. */
  slug: 'items' | 'categories' | 'vendors';
  path: `/catalog/${CatalogSection['slug']}`;
  /** What the matching API area enforces; the route and the links both use it. */
  permission: Permission;
  label: MessageKey;
}

/** The catalog's sections: the one list that the sub-navigation and the routes use. */
export const CATALOG_SECTIONS: readonly CatalogSection[] = [
  { slug: 'items', path: '/catalog/items', permission: 'item:write', label: 'nav.catalogItems' },
  {
    slug: 'categories',
    path: '/catalog/categories',
    permission: 'category:write',
    label: 'nav.catalogCategories',
  },
  {
    slug: 'vendors',
    path: '/catalog/vendors',
    permission: 'vendor:write',
    label: 'nav.catalogVendors',
  },
];

/** The sections a person holding `permissions` may open. */
export function visibleCatalogSections(permissions: readonly Permission[]): CatalogSection[] {
  return CATALOG_SECTIONS.filter((section) => permissions.includes(section.permission));
}
