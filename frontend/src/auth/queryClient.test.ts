import { QueryObserver, type QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { cashierMe } from '../test/meFixture';
import { queryKeys } from './cache';
import { createQueryClient } from './queryClient';

function loggedInClient(): QueryClient {
  const client = createQueryClient();
  client.setQueryData(queryKeys.me, cashierMe());
  client.setQueryData(['items', 1], [{ id: 10 }]);
  return client;
}

const failing = (error: unknown) => () => Promise.reject(error);

describe('createQueryClient — a query that fails', () => {
  it('ends the session when the server says it is gone, with a reason', async () => {
    const client = loggedInClient();
    await client
      .fetchQuery({
        queryKey: ['bills'],
        queryFn: failing(new ApiError('SESSION_EXPIRED', 'expired', 401)),
      })
      .catch(() => undefined);
    expect(client.getQueryData(queryKeys.me)).toBeNull();
    expect(client.getQueryData(['items', 1])).toBeUndefined();
    expect(client.getQueryData(queryKeys.sessionNotice)).toBe('login.sessionExpired');
  });

  it('ends the session quietly on a plain 401', async () => {
    const client = loggedInClient();
    await client
      .fetchQuery({
        queryKey: ['bills'],
        queryFn: failing(new ApiError('UNAUTHORIZED', 'log in', 401)),
      })
      .catch(() => undefined);
    expect(client.getQueryData(queryKeys.me)).toBeNull();
    expect(client.getQueryData(queryKeys.sessionNotice)).toBeNull();
  });

  it('reloads who the user is when their branch or password state changed', async () => {
    const client = loggedInClient();
    await client
      .fetchQuery({
        queryKey: ['bills'],
        queryFn: failing(new ApiError('NO_ACTIVE_BRANCH', 'pick one', 403)),
      })
      .catch(() => undefined);
    expect(client.getQueryData(queryKeys.me)).toEqual(cashierMe());
    expect(client.getQueryState(queryKeys.me)?.isInvalidated).toBe(true);
  });

  it('does not refetch in a loop when the "who am I" query itself fails that way', async () => {
    const client = createQueryClient();
    let calls = 0;
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.me,
      queryFn: () => {
        calls += 1;
        // Fails on a later tick, like a real request; an instant failure would turn a loop
        // into a microtask spin that hangs the test run instead of failing it
        return new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new ApiError('NO_ACTIVE_BRANCH', 'pick one', 403)), 1),
        );
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    // Give a (wrong) invalidation-triggered refetch the chance to happen
    await new Promise((resolve) => setTimeout(resolve, 50));
    unsubscribe();
    expect(calls).toBe(1);
  });

  it('refetches an active "who am I" query when another call shows it is stale', async () => {
    const client = createQueryClient();
    let calls = 0;
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.me,
      queryFn: () => {
        calls += 1;
        return Promise.resolve(cashierMe());
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(calls).toBe(1));
    await client
      .fetchQuery({
        queryKey: ['bills'],
        queryFn: failing(new ApiError('NO_ACTIVE_BRANCH', 'pick one', 403)),
      })
      .catch(() => undefined);
    await vi.waitFor(() => expect(calls).toBe(2));
    unsubscribe();
  });

  it('leaves the session alone for an ordinary failure', async () => {
    const client = loggedInClient();
    await client
      .fetchQuery({
        queryKey: ['bills'],
        queryFn: failing(new ApiError('NOT_FOUND', 'missing', 404)),
      })
      .catch(() => undefined);
    expect(client.getQueryData(queryKeys.me)).toEqual(cashierMe());
    expect(client.getQueryState(queryKeys.me)?.isInvalidated).toBe(false);
    expect(client.getQueryData(['items', 1])).toEqual([{ id: 10 }]);
  });
});

describe('createQueryClient — when "who am I" answers nobody', () => {
  const refetchMe = (client: QueryClient, answer: unknown) =>
    client.fetchQuery({
      queryKey: queryKeys.me,
      queryFn: () => Promise.resolve(answer),
      staleTime: 0,
    });

  it('drops everything else that was cached for the person who was logged in', async () => {
    const client = loggedInClient();
    await refetchMe(client, null);
    expect(client.getQueryData(queryKeys.me)).toBeNull();
    expect(client.getQueryData(['items', 1])).toBeUndefined();
  });

  it('keeps the cached data when the answer is still a logged-in user', async () => {
    const client = loggedInClient();
    await refetchMe(client, cashierMe());
    expect(client.getQueryData(queryKeys.me)).toEqual(cashierMe());
    expect(client.getQueryData(['items', 1])).toEqual([{ id: 10 }]);
  });
});

describe('createQueryClient — a mutation that fails', () => {
  const run = (client: QueryClient, error: unknown) =>
    client
      .getMutationCache()
      .build(client, { mutationFn: failing(error) })
      .execute(undefined)
      .catch(() => undefined);

  it('ends the session when the server says it is gone', async () => {
    const client = loggedInClient();
    await run(client, new ApiError('ACCOUNT_DISABLED', 'disabled', 401));
    expect(client.getQueryData(queryKeys.me)).toBeNull();
    expect(client.getQueryData(queryKeys.sessionNotice)).toBe('login.accountDisabled');
  });

  it('keeps the session after a wrong password (a 401 that is not a lost session)', async () => {
    const client = loggedInClient();
    await run(client, new ApiError('INVALID_CREDENTIALS', 'wrong', 401));
    expect(client.getQueryData(queryKeys.me)).toEqual(cashierMe());
  });

  it('never retries a mutation, so a bill or a login is not sent twice', () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
