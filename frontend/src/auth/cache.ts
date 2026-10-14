import type { MeResponse } from '@ds/shared';
import type { Query, QueryClient } from '@tanstack/react-query';
import type { MessageKey } from '../i18n/en';

/** Query keys the auth layer owns. Every other key is data that belongs to the logged-in user. */
export const queryKeys = {
  /** MeResponse when logged in, null when not. */
  me: ['me'] as const,
  /** Why the session ended, for the login page (a MessageKey), or null. */
  sessionNotice: ['sessionNotice'] as const,
};

const isAuthKey = (query: Query) =>
  query.queryKey[0] === queryKeys.me[0] || query.queryKey[0] === queryKeys.sessionNotice[0];

/** Forget everything fetched for the previous user or branch; keep who is logged in. */
export function clearBranchData(client: QueryClient): void {
  // In-flight fetches are cancelled too, so a late reply can't repopulate the cache.
  // The `me` query is left alone: cancelling it could revert the value just written.
  void client.cancelQueries({ predicate: (query) => !isAuthKey(query) });
  client.removeQueries({ predicate: (query) => !isAuthKey(query) });
}

/** Record a fresh login: the new user in, the previous user's data out. */
export function startSession(client: QueryClient, me: MeResponse): void {
  clearBranchData(client);
  client.setQueryData(queryKeys.sessionNotice, null);
  client.setQueryData(queryKeys.me, me);
}

/** Record that nobody is logged in; `notice` says why, for the login page. */
export function endSession(client: QueryClient, notice: MessageKey | null = null): void {
  clearBranchData(client);
  client.setQueryData(queryKeys.sessionNotice, notice);
  client.setQueryData(queryKeys.me, null);
}
