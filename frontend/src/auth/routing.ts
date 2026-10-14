import type { MeResponse } from '@ds/shared';

const LOGIN = '/login';
const CHANGE_PASSWORD = '/change-password';
const SELECT_BRANCH = '/select-branch';

/** Where a person with no other task lands: Admin → admin area, Cashier → billing. */
export function homeFor(me: Pick<MeResponse, 'permissions'>): string {
  if (me.permissions.includes('admin:branches')) return '/admin';
  if (me.permissions.includes('bill:create')) return '/billing';
  return '/no-access';
}

/**
 * A "come back here after login" path, or null if it isn't a plain path inside this app.
 * Refuses absolute and protocol-relative URLs (open-redirect tricks), backslashes, control
 * characters and the login page itself.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || /\p{Cc}/u.test(value)) return null;
  if (value === LOGIN || value.startsWith(`${LOGIN}?`) || value.startsWith(`${LOGIN}/`)) {
    return null;
  }
  return value;
}

export interface RouteOptions {
  /**
   * Whether a logged-out visitor's page is remembered (`?next=`) so login returns them to
   * it. Default true, for someone arriving on a link. Pass false once someone has been
   * logged in during this visit: after a logout the next person to log in on a shared
   * counter PC may be a different role and must start from their own home.
   */
  rememberPath?: boolean;
}

/**
 * The one place that decides where a visitor must be. Returns the path to redirect to, or
 * null when the page they asked for may show. Order matters: logged out → login; a due
 * password change blocks everything; a due branch choice blocks everything but the picker
 * and the password page; then the login page and the root hand over to the role's home.
 */
export function requiredRoute(
  me: MeResponse | null,
  location: { pathname: string; search: string },
  { rememberPath = true }: RouteOptions = {},
): string | null {
  const { pathname, search } = location;

  if (!me) {
    if (pathname === LOGIN) return null;
    if (pathname === '/' || !rememberPath) return LOGIN;
    return `${LOGIN}?next=${encodeURIComponent(pathname + search)}`;
  }

  if (me.user.mustChangePassword) {
    return pathname === CHANGE_PASSWORD ? null : CHANGE_PASSWORD;
  }
  if (me.needsBranchSelection) {
    return pathname === SELECT_BRANCH || pathname === CHANGE_PASSWORD ? null : SELECT_BRANCH;
  }
  if (pathname === LOGIN) {
    return safeReturnPath(new URLSearchParams(search).get('next')) ?? homeFor(me);
  }
  if (pathname === '/') return homeFor(me);
  // Switching branch only makes sense with more than one to switch between
  if (pathname === SELECT_BRANCH && me.branches.length < 2) return homeFor(me);
  return null;
}
