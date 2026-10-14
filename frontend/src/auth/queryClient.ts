import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { clearBranchData, endSession, queryKeys } from './cache';
import { isSessionLost, sessionNoticeFor, shouldRefreshMe, shouldRetry } from './session';

/**
 * The app's QueryClient, with the session rules wired in once for every call: a lost
 * session logs the visitor out (with the reason), an account change reloads `me`, and a
 * "nobody is logged in" answer drops everything cached for the previous user.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) =>
        handleFailure(client, error, query.queryKey[0] === queryKeys.me[0]),
      // "Nobody is logged in" can arrive as a plain answer (e.g. the session was deleted
      // while the tab was idle); nothing fetched for the previous user may linger
      onSuccess: (data, query) => {
        if (query.queryKey[0] === queryKeys.me[0] && data === null) clearBranchData(client);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => handleFailure(client, error, false),
    }),
    defaultOptions: {
      queries: { retry: shouldRetry },
      // A mutation (a bill, a login) is never repeated automatically
      mutations: { retry: false },
    },
  });
  return client;
}

function handleFailure(client: QueryClient, error: unknown, isMeQuery: boolean): void {
  if (isSessionLost(error)) {
    endSession(client, sessionNoticeFor(error));
  } else if (!isMeQuery && shouldRefreshMe(error)) {
    // `me` can't report these itself; refetching it from its own failure would loop
    void client.invalidateQueries({ queryKey: queryKeys.me });
  }
}
