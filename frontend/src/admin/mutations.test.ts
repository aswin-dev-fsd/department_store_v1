import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminKeys } from './keys';
import {
  createBranchOptions,
  createUserOptions,
  resetPasswordOptions,
  setUserBranchesOptions,
  updateBranchOptions,
  updateSettingsOptions,
  updateUserOptions,
} from './mutations';

const meta = { timestamp: '2026-10-10T00:00:00.000Z', version: '0.1.0' };
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

/** Answer every request with this data in the success envelope. */
function respondWith(data: unknown, status = 200) {
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ success: true, data, meta }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
}

/** Run one mutation to completion, the way a component's useMutation would. */
function run<TData, TVars>(
  options: Parameters<typeof MutationObserver.prototype.setOptions>[0],
  variables: TVars,
) {
  const observer = new MutationObserver<TData, Error, TVars>(client, options as never);
  return { observer, done: observer.mutate(variables) };
}

/** Seed a cached query so we can tell whether it was marked stale. */
function seed(key: readonly unknown[]) {
  client.setQueryData(key, { items: [] });
  return () => client.getQueryCache().find({ queryKey: key })!.state.isInvalidated;
}

beforeEach(() => {
  client = new QueryClient();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    method: init.method,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
  };
}

describe('branch mutations', () => {
  it('create: POSTs the branch and refreshes branch lists, the branch checklist and user lists', async () => {
    respondWith({ id: 1 }, 201);
    const branchesStale = seed(adminKeys.branchList(20, 0));
    const optionsStale = seed(adminKeys.branchOptions);
    const usersStale = seed(adminKeys.userList(20, 0));
    const settingsStale = seed(adminKeys.settings);

    const input = {
      code: 'TPR',
      name: 'Tiruppur',
      address: '12 Main Road',
      phone: null,
      billFooter: null,
    };
    await run(createBranchOptions(client), input).done;

    expect(lastRequest()).toEqual({ url: '/api/v1/admin/branches', method: 'POST', body: input });
    expect(branchesStale()).toBe(true);
    expect(optionsStale()).toBe(true);
    // user cards show branch names, so they are stale too
    expect(usersStale()).toBe(true);
    expect(settingsStale()).toBe(false);
  });

  it('update: PATCHes only the given changes to that branch and refreshes the same lists', async () => {
    respondWith({ id: 5 });
    const branchesStale = seed(adminKeys.branchList(20, 0));
    const usersStale = seed(adminKeys.userList(20, 0));

    await run(updateBranchOptions(client), { id: 5, changes: { isActive: false } }).done;

    expect(lastRequest()).toEqual({
      url: '/api/v1/admin/branches/5',
      method: 'PATCH',
      body: { isActive: false },
    });
    expect(branchesStale()).toBe(true);
    expect(usersStale()).toBe(true);
  });
});

describe('user mutations', () => {
  it('create: POSTs the user and refreshes user lists only', async () => {
    respondWith({ user: { id: 7 }, temporaryPassword: 'Tmp-Secret-1' }, 201);
    const usersStale = seed(adminKeys.userList(20, 0));
    const branchesStale = seed(adminKeys.branchList(20, 0));

    const input = { username: 'ravi', fullName: 'Ravi Kumar', role: 'cashier' as const };
    await run(createUserOptions(client), input).done;

    expect(lastRequest()).toEqual({ url: '/api/v1/admin/users', method: 'POST', body: input });
    expect(usersStale()).toBe(true);
    expect(branchesStale()).toBe(false);
  });

  it('update: PATCHes the changes to that user and refreshes user lists', async () => {
    respondWith({ id: 7 });
    const usersStale = seed(adminKeys.userList(20, 0));
    await run(updateUserOptions(client), { id: 7, changes: { fullName: 'Ravi K' } }).done;
    expect(lastRequest()).toEqual({
      url: '/api/v1/admin/users/7',
      method: 'PATCH',
      body: { fullName: 'Ravi K' },
    });
    expect(usersStale()).toBe(true);
  });

  it('reset password: POSTs with no body and refreshes user lists (they must now change it)', async () => {
    respondWith({ temporaryPassword: 'Tmp-Secret-2' });
    const usersStale = seed(adminKeys.userList(20, 0));
    await run(resetPasswordOptions(client), 7).done;
    expect(lastRequest()).toEqual({
      url: '/api/v1/admin/users/7/reset-password',
      method: 'POST',
      body: undefined,
    });
    expect(usersStale()).toBe(true);
  });

  it('set branches: PUTs the complete list and refreshes user lists', async () => {
    respondWith({ id: 7 });
    const usersStale = seed(adminKeys.userList(20, 0));
    await run(setUserBranchesOptions(client), { id: 7, branchIds: [1, 2] }).done;
    expect(lastRequest()).toEqual({
      url: '/api/v1/admin/users/7/branches',
      method: 'PUT',
      body: { branchIds: [1, 2] },
    });
    expect(usersStale()).toBe(true);
  });
});

describe('settings mutation', () => {
  it('PUTs the settings and puts the saved record straight into the cache', async () => {
    const saved = {
      businessName: 'Demo Stores',
      address: null,
      phone: null,
      updatedAt: '2026-10-14T00:00:00.000Z',
    };
    respondWith(saved);
    await run(updateSettingsOptions(client), {
      businessName: 'Demo Stores',
      address: null,
      phone: null,
    }).done;
    expect(lastRequest()).toMatchObject({ url: '/api/v1/admin/settings', method: 'PUT' });
    expect(client.getQueryData(adminKeys.settings)).toEqual(saved);
  });
});

describe('one-time temporary passwords', () => {
  async function leftInCache(
    options: Parameters<typeof run>[0],
    variables: unknown,
    data: unknown,
  ) {
    respondWith(data, 201);
    const { observer, done } = run(options, variables);
    await done;
    // the screen is done with the result (dismissed, or navigated away)
    observer.reset();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return client.getMutationCache().getAll().length;
  }

  it('are not kept in memory once the screen lets go of a created user', async () => {
    const left = await leftInCache(
      createUserOptions(client),
      { username: 'ravi', fullName: 'Ravi Kumar', role: 'cashier' },
      { user: { id: 7 }, temporaryPassword: 'Tmp-Secret-1' },
    );
    expect(left).toBe(0);
  });

  it('are not kept in memory once the screen lets go of a reset', async () => {
    const left = await leftInCache(resetPasswordOptions(client), 7, {
      temporaryPassword: 'Tmp-Secret-2',
    });
    expect(left).toBe(0);
  });
});
