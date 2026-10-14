import type { Permission } from '@ds/shared';
import type { MessageKey } from '../i18n/en';

export interface AdminSection {
  /** Last part of the address: the section lives at /admin/<slug>. */
  slug: 'branches' | 'users' | 'settings';
  path: `/admin/${AdminSection['slug']}`;
  /** What the matching API area enforces; the route and the links both use it. */
  permission: Permission;
  label: MessageKey;
  blurb: MessageKey;
}

/** The Admin area's sections: the one list that the hub, the sub-navigation and the routes use. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    slug: 'branches',
    path: '/admin/branches',
    permission: 'admin:branches',
    label: 'nav.adminBranches',
    blurb: 'adminHome.branchesBlurb',
  },
  {
    slug: 'users',
    path: '/admin/users',
    permission: 'admin:users',
    label: 'nav.adminUsers',
    blurb: 'adminHome.usersBlurb',
  },
  {
    slug: 'settings',
    path: '/admin/settings',
    permission: 'admin:settings',
    label: 'nav.adminSettings',
    blurb: 'adminHome.settingsBlurb',
  },
];

/** The sections a person holding `permissions` may open. */
export function visibleSections(permissions: readonly Permission[]): AdminSection[] {
  return ADMIN_SECTIONS.filter((section) => permissions.includes(section.permission));
}
