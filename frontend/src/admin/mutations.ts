import type {
  Branch,
  ClientSettings,
  CreateBranchInput,
  CreatedUser,
  CreateUserInput,
  PasswordReset,
  UpdateBranchInput,
  UpdateSettingsInput,
  UpdateUserInput,
  UserSummary,
} from '@ds/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { adminKeys } from './keys';

// Each mutation is a plain options object built from the QueryClient, so tests can run it
// without React; the use… hooks below only hand it to useMutation.

/** A branch changed: branch lists and the checklist are stale, and so are user cards (they show branches). */
function refreshBranchData(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: adminKeys.branches }),
    client.invalidateQueries({ queryKey: adminKeys.users }),
  ]);
}

function refreshUsers(client: QueryClient) {
  return client.invalidateQueries({ queryKey: adminKeys.users });
}

export const createBranchOptions = (client: QueryClient) => ({
  mutationFn: (input: CreateBranchInput) => api.post<Branch>('/admin/branches', input),
  onSuccess: () => refreshBranchData(client),
});

export const updateBranchOptions = (client: QueryClient) => ({
  mutationFn: ({ id, changes }: { id: number; changes: UpdateBranchInput }) =>
    api.patch<Branch>(`/admin/branches/${id}`, changes),
  onSuccess: () => refreshBranchData(client),
});

export const createUserOptions = (client: QueryClient) => ({
  mutationFn: (input: CreateUserInput) => api.post<CreatedUser>('/admin/users', input),
  onSuccess: () => refreshUsers(client),
  // The reply holds the one-time temporary password: drop it from memory as soon as no
  // screen is looking at the mutation
  gcTime: 0,
});

export const updateUserOptions = (client: QueryClient) => ({
  mutationFn: ({ id, changes }: { id: number; changes: UpdateUserInput }) =>
    api.patch<UserSummary>(`/admin/users/${id}`, changes),
  onSuccess: () => refreshUsers(client),
});

export const resetPasswordOptions = (client: QueryClient) => ({
  mutationFn: (id: number) => api.post<PasswordReset>(`/admin/users/${id}/reset-password`),
  onSuccess: () => refreshUsers(client),
  // Holds a one-time temporary password too
  gcTime: 0,
});

export const setUserBranchesOptions = (client: QueryClient) => ({
  mutationFn: ({ id, branchIds }: { id: number; branchIds: number[] }) =>
    api.put<UserSummary>(`/admin/users/${id}/branches`, { branchIds }),
  onSuccess: () => refreshUsers(client),
});

export const updateSettingsOptions = (client: QueryClient) => ({
  mutationFn: (input: UpdateSettingsInput) => api.put<ClientSettings>('/admin/settings', input),
  // The reply is the saved record, so no refetch is needed
  onSuccess: (saved: ClientSettings) => {
    client.setQueryData(adminKeys.settings, saved);
  },
});

/** Create a branch. */
export function useCreateBranch() {
  return useMutation(createBranchOptions(useQueryClient()));
}

/** Edit a branch, or deactivate or reactivate it (`isActive`). */
export function useUpdateBranch() {
  return useMutation(updateBranchOptions(useQueryClient()));
}

/** Create a user; the reply carries the one-time temporary password. */
export function useCreateUser() {
  return useMutation(createUserOptions(useQueryClient()));
}

/** Edit a user's name, or deactivate or reactivate the account (`isActive`). */
export function useUpdateUser() {
  return useMutation(updateUserOptions(useQueryClient()));
}

/** Give a user a new one-time temporary password; their sessions end. */
export function useResetPassword() {
  return useMutation(resetPasswordOptions(useQueryClient()));
}

/** Replace a cashier's list of branches. */
export function useSetUserBranches() {
  return useMutation(setUserBranchesOptions(useQueryClient()));
}

/** Save the client settings. */
export function useUpdateSettings() {
  return useMutation(updateSettingsOptions(useQueryClient()));
}
