import {
  MAX_PAGE_SIZE,
  type Branch,
  type BranchSummary,
  type ClientSettings,
  type Page,
  type UserSummary,
} from '@ds/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { adminKeys } from './keys';
import { ADMIN_PAGE_SIZE } from './paging';

/** One page of branches, newest page kept on screen while the next one loads. */
export function useBranches(offset: number) {
  return useQuery({
    queryKey: adminKeys.branchList(ADMIN_PAGE_SIZE, offset),
    queryFn: () =>
      api.get<Page<Branch>>(`/admin/branches?limit=${ADMIN_PAGE_SIZE}&offset=${offset}`),
    placeholderData: keepPreviousData,
  });
}

/** Active branches for the cashier-mapping checklist (the API's largest page). */
export function useBranchOptions() {
  return useQuery({
    queryKey: adminKeys.branchOptions,
    queryFn: async (): Promise<BranchSummary[]> => {
      const page = await api.get<Page<Branch>>(
        `/admin/branches?isActive=true&limit=${MAX_PAGE_SIZE}`,
      );
      return page.items.map(({ id, code, name }) => ({ id, code, name }));
    },
  });
}

/** One page of users, each with their branches. */
export function useUsers(offset: number) {
  return useQuery({
    queryKey: adminKeys.userList(ADMIN_PAGE_SIZE, offset),
    queryFn: () =>
      api.get<Page<UserSummary>>(`/admin/users?limit=${ADMIN_PAGE_SIZE}&offset=${offset}`),
    placeholderData: keepPreviousData,
  });
}

/** The client settings (a 404 NOT_SET_UP if `setup:client` was never run). */
export function useSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => api.get<ClientSettings>('/admin/settings'),
  });
}
