import type { ChangePasswordInput, LoginInput, MeResponse } from '@ds/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { clearBranchData, endSession, queryKeys, startSession } from './cache';

/** Log in. On success the new user replaces whatever was cached, and the route guard moves on. */
export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<MeResponse>('/auth/login', input),
    onSuccess: (me) => startSession(client, me),
  });
}

/** Log out. The local session is cleared only once the server has ended it. */
export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ loggedOut: boolean }>('/auth/logout'),
    onSuccess: () => endSession(client),
  });
}

/** Change the logged-in user's password; the reply clears a forced change. */
export function useChangePassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api.post<MeResponse>('/auth/change-password', input),
    onSuccess: (me) => client.setQueryData(queryKeys.me, me),
  });
}

/** Switch a cashier's working branch; data fetched for the old branch is dropped. */
export function useSelectBranch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (branchId: number) => api.post<MeResponse>('/auth/select-branch', { branchId }),
    onSuccess: (me) => {
      clearBranchData(client);
      client.setQueryData(queryKeys.me, me);
    },
  });
}
