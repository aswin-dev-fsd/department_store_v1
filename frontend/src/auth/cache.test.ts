import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { adminMe, cashierMe } from '../test/meFixture';
import { clearBranchData, endSession, queryKeys, startSession } from './cache';

function clientWithData() {
  const client = new QueryClient();
  client.setQueryData(queryKeys.me, cashierMe());
  client.setQueryData(['items', 1], [{ id: 10 }]);
  client.setQueryData(['bills', 'today'], [{ id: 20 }]);
  return client;
}

describe('endSession', () => {
  it('marks the visitor logged out and drops everything the last user could see', () => {
    const client = clientWithData();
    endSession(client);
    expect(client.getQueryData(queryKeys.me)).toBeNull();
    expect(client.getQueryData(['items', 1])).toBeUndefined();
    expect(client.getQueryData(['bills', 'today'])).toBeUndefined();
  });

  it('leaves a notice for the login page when the session ended on its own', () => {
    const client = clientWithData();
    endSession(client, 'login.sessionExpired');
    expect(client.getQueryData(queryKeys.sessionNotice)).toBe('login.sessionExpired');
  });

  it('leaves no notice after a plain logout, and clears an old one', () => {
    const client = clientWithData();
    client.setQueryData(queryKeys.sessionNotice, 'login.sessionExpired');
    endSession(client);
    expect(client.getQueryData(queryKeys.sessionNotice)).toBeNull();
  });
});

describe('startSession', () => {
  it('stores the new user and never lets the previous user data through', () => {
    const client = clientWithData();
    client.setQueryData(queryKeys.sessionNotice, 'login.sessionExpired');
    const admin = adminMe();
    startSession(client, admin);
    expect(client.getQueryData(queryKeys.me)).toEqual(admin);
    expect(client.getQueryData(['items', 1])).toBeUndefined();
    expect(client.getQueryData(queryKeys.sessionNotice)).toBeNull();
  });
});

describe('clearBranchData', () => {
  it('drops branch-scoped data but keeps who is logged in', () => {
    const client = clientWithData();
    clearBranchData(client);
    expect(client.getQueryData(queryKeys.me)).toEqual(cashierMe());
    expect(client.getQueryData(['items', 1])).toBeUndefined();
    expect(client.getQueryData(['bills', 'today'])).toBeUndefined();
  });
});
