// Every UI label (D-25). Tamil arrives later as a second dictionary with the same keys.
// Use {name} for values filled in by t(key, { name }).
export const en = {
  'app.name': 'Department Store',

  'common.loading': 'Loading…',
  'common.stillConnecting': 'Still connecting… the server may be waking up.',
  'common.retry': 'Try again',
  'common.backToStart': 'Go to the start page',

  'status.title': 'System status',
  'status.apiLine': 'API: {status}',
  'status.databaseLine': 'Database: {status}',
  'status.checking': 'checking…',
  'status.ok': 'ok',
  'status.down': 'down',
  'status.unreachable': 'unreachable',

  'role.admin': 'Admin',
  'role.cashier': 'Cashier',

  'nav.main': 'Main menu',
  'nav.billing': 'Billing',
  'nav.admin': 'Administration',

  'shell.branch': 'Branch: {branch}',
  'shell.changeBranch': 'Change branch',
  'shell.changePassword': 'Change password',
  'shell.logout': 'Log out',
  'shell.loggingOut': 'Logging out…',

  'login.title': 'Log in',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.submit': 'Log in',
  'login.submitting': 'Logging in…',
  'login.sessionExpired': 'Your session has ended. Please log in again.',
  'login.accountDisabled': 'This account has been deactivated. Ask the Admin.',

  'changePassword.title': 'Change password',
  'changePassword.required': 'Choose a new password before you continue.',
  'changePassword.hint': 'Use at least {min} characters, different from the current one.',
  'changePassword.current': 'Current password',
  'changePassword.new': 'New password',
  'changePassword.confirm': 'New password again',
  'changePassword.mismatch': 'The two new passwords are not the same',
  'changePassword.show': 'Show passwords',
  'changePassword.submit': 'Change password',
  'changePassword.submitting': 'Changing…',
  'changePassword.done': 'Your password has been changed.',
  'changePassword.cancel': 'Cancel',

  'branchPicker.title': 'Choose your branch',
  'branchPicker.intro': 'Pick the branch you are working in today.',
  'branchPicker.current': 'Current',
  'branchPicker.none':
    'No branch has been assigned to your account yet. Ask the Admin to assign one, then log in again.',

  'adminHome.title': 'Administration',
  'adminHome.intro': 'Branches, users and settings are managed from here.',

  'billing.title': 'Billing',
  'billing.placeholder':
    'The billing counter is built in a later phase. You are working in {branch}.',

  'noAccess.title': 'No access',
  'noAccess.body': 'Your account is not allowed to open this page.',

  'error.generic': 'Something went wrong. Please try again.',
  'error.NETWORK_ERROR': 'Cannot reach the server. Check the internet connection and try again.',
  'error.BAD_RESPONSE': 'The server sent an unexpected reply. Try again in a moment.',
  'error.INTERNAL_ERROR': 'The server had a problem. Please try again.',
  'error.VALIDATION_ERROR': 'Some details are not valid. Check the form and try again.',
  'error.INVALID_CREDENTIALS': 'Wrong username or password.',
  'error.WRONG_CURRENT_PASSWORD': 'The current password is not correct.',
  'error.PASSWORD_UNCHANGED': 'Choose a password different from the current one.',
  'error.ACCOUNT_DISABLED': 'This account has been deactivated. Ask the Admin.',
  'error.SESSION_EXPIRED': 'Your session has ended. Please log in again.',
  'error.UNAUTHORIZED': 'Please log in.',
  'error.FORBIDDEN': 'Your account is not allowed to do this.',
  'error.BRANCH_NOT_ASSIGNED': 'You are not assigned to that branch.',
  'error.NO_ACTIVE_BRANCH': 'Choose a branch to work in first.',
  'error.PASSWORD_CHANGE_REQUIRED': 'Change your password before continuing.',
} as const;

export type MessageKey = keyof typeof en;
