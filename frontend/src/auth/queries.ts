import type { MeResponse } from '@ds/shared';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { queryKeys } from './cache';

/**
 * Who is logged in. Resolves to null when nobody is — that is an answer, not an error. A
 * session that existed but ended (SESSION_EXPIRED, ACCOUNT_DISABLED) still throws, so the
 * query client can end the session with a reason.
 */
export async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await api.get<MeResponse>('/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHORIZED') {
      return null;
    }
    throw error;
  }
}

/** The logged-in user (null = logged out). Re-checked when the window regains focus. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: fetchMe,
    // Focus re-checks catch a deactivation or branch change within seconds of coming back
    staleTime: 30_000,
  });
}

/** Why the last session ended, for the login page; null when it ended normally. */
export function useSessionNotice() {
  return useQuery({
    queryKey: queryKeys.sessionNotice,
    // The value is written by endSession/startSession; this function only supplies the default
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
  }).data;
}
