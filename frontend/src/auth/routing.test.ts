import { describe, expect, it } from 'vitest';
import { adminMe, cashierMe, twoBranchCashierMe, withPasswordChangeDue } from '../test/meFixture';
import { homeFor, requiredRoute, safeReturnPath } from './routing';

const at = (pathname: string, search = '') => ({ pathname, search });

describe('homeFor', () => {
  it('sends an Admin to the admin area and a Cashier to billing', () => {
    expect(homeFor(adminMe())).toBe('/admin');
    expect(homeFor(cashierMe())).toBe('/billing');
  });

  it('sends a role with neither permission to the no-access page, not a loop', () => {
    expect(homeFor(adminMe({ permissions: ['stock:read'] }))).toBe('/no-access');
  });
});

describe('safeReturnPath', () => {
  it('accepts a path inside the app, with its query', () => {
    expect(safeReturnPath('/billing')).toBe('/billing');
    expect(safeReturnPath('/admin/users?page=2')).toBe('/admin/users?page=2');
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty string', ''],
    ['an absolute URL', 'https://evil.example/steal'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash trick', '/\\evil.example'],
    ['a path without a leading slash', 'billing'],
    ['a control character', '/bill\ning'],
    ['the login page itself', '/login'],
    ['the login page with a query', '/login?next=/billing'],
  ])('refuses %s', (_label, value) => {
    expect(safeReturnPath(value)).toBeNull();
  });
});

describe('requiredRoute — logged out', () => {
  it('lets the login page show', () => {
    expect(requiredRoute(null, at('/login'))).toBeNull();
  });

  it('sends the root to a plain login page', () => {
    expect(requiredRoute(null, at('/'))).toBe('/login');
  });

  it('remembers where the visitor was going', () => {
    expect(requiredRoute(null, at('/billing'))).toBe('/login?next=%2Fbilling');
    expect(requiredRoute(null, at('/admin/users', '?page=2'))).toBe(
      '/login?next=%2Fadmin%2Fusers%3Fpage%3D2',
    );
  });
});

describe('requiredRoute — logged out after being logged in', () => {
  // A logout (or an ended session) on a shared counter PC must not send the next person,
  // who may be a different role, to the previous person's last page
  const forgetting = { rememberPath: false };

  it('goes to a plain login page, whatever page the visitor was on', () => {
    expect(requiredRoute(null, at('/billing'), forgetting)).toBe('/login');
    expect(requiredRoute(null, at('/admin/users', '?page=2'), forgetting)).toBe('/login');
    expect(requiredRoute(null, at('/select-branch'), forgetting)).toBe('/login');
    expect(requiredRoute(null, at('/'), forgetting)).toBe('/login');
  });

  it('still lets the login page show', () => {
    expect(requiredRoute(null, at('/login'), forgetting)).toBeNull();
  });

  it('does not change anything for a visitor who is logged in', () => {
    expect(requiredRoute(adminMe(), at('/admin'), forgetting)).toBeNull();
    expect(requiredRoute(cashierMe(), at('/login', '?next=%2Fbilling'), forgetting)).toBe(
      '/billing',
    );
  });
});

describe('requiredRoute — password change due', () => {
  const me = withPasswordChangeDue(adminMe());

  it('allows only the change-password page', () => {
    expect(requiredRoute(me, at('/change-password'))).toBeNull();
    expect(requiredRoute(me, at('/admin'))).toBe('/change-password');
    expect(requiredRoute(me, at('/'))).toBe('/change-password');
    expect(requiredRoute(me, at('/login'))).toBe('/change-password');
  });

  it('comes before a pending branch choice', () => {
    const cashier = withPasswordChangeDue(twoBranchCashierMe());
    expect(requiredRoute(cashier, at('/select-branch'))).toBe('/change-password');
    expect(requiredRoute(cashier, at('/billing'))).toBe('/change-password');
  });
});

describe('requiredRoute — branch choice due', () => {
  const me = twoBranchCashierMe();

  it('allows the picker and the password page, nothing else', () => {
    expect(requiredRoute(me, at('/select-branch'))).toBeNull();
    expect(requiredRoute(me, at('/change-password'))).toBeNull();
    expect(requiredRoute(me, at('/billing'))).toBe('/select-branch');
    expect(requiredRoute(me, at('/'))).toBe('/select-branch');
    expect(requiredRoute(me, at('/login'))).toBe('/select-branch');
  });

  it('keeps a cashier with no branch on the picker, which explains what to do', () => {
    const none = cashierMe({ branches: [], activeBranchId: null, needsBranchSelection: true });
    expect(requiredRoute(none, at('/select-branch'))).toBeNull();
    expect(requiredRoute(none, at('/billing'))).toBe('/select-branch');
  });
});

describe('requiredRoute — logged in and ready', () => {
  it('sends the root to the role home', () => {
    expect(requiredRoute(adminMe(), at('/'))).toBe('/admin');
    expect(requiredRoute(cashierMe(), at('/'))).toBe('/billing');
  });

  it('lets any other page show (permissions are checked by the page)', () => {
    expect(requiredRoute(adminMe(), at('/admin'))).toBeNull();
    expect(requiredRoute(cashierMe(), at('/billing'))).toBeNull();
    expect(requiredRoute(cashierMe(), at('/admin'))).toBeNull();
    expect(requiredRoute(cashierMe(), at('/no-access'))).toBeNull();
  });

  it('moves a logged-in visitor off the login page to where they were going', () => {
    expect(requiredRoute(cashierMe(), at('/login'))).toBe('/billing');
    expect(requiredRoute(cashierMe(), at('/login', '?next=%2Fbilling%3Fa%3D1'))).toBe(
      '/billing?a=1',
    );
  });

  it('ignores an unsafe next on the login page', () => {
    expect(requiredRoute(adminMe(), at('/login', '?next=https%3A%2F%2Fevil.example'))).toBe(
      '/admin',
    );
    expect(requiredRoute(adminMe(), at('/login', '?next=%2F%2Fevil.example'))).toBe('/admin');
  });

  it('keeps the branch picker for a cashier with several branches (to switch)', () => {
    const me = cashierMe({
      branches: [
        { id: 1, code: 'TPR', name: 'Tiruppur' },
        { id: 2, code: 'CBE', name: 'Coimbatore' },
      ],
    });
    expect(requiredRoute(me, at('/select-branch'))).toBeNull();
  });

  it('sends the picker home when there is nothing to choose', () => {
    expect(requiredRoute(cashierMe(), at('/select-branch'))).toBe('/billing');
    expect(requiredRoute(adminMe(), at('/select-branch'))).toBe('/admin');
  });
});
