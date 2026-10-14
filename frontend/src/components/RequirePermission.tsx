import type { Permission } from '@ds/shared';
import type { ReactNode } from 'react';
import { useMe } from '../auth/queries';
import { NoAccessPage } from '../pages/NoAccessPage';

/**
 * Shows its children only to someone holding `permission` (from the server's `me` reply, the
 * same map the API enforces). Anyone else sees the no-access page. This is courtesy: the
 * server checks every call itself.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const me = useMe().data;
  if (!me?.permissions.includes(permission)) return <NoAccessPage />;
  return children;
}
