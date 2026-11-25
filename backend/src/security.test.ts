// Route-level security checks (Task 7.2, docs/security-checklist.md): every route is listed from
// the real routers, so a new route that skips a permission check or an audited test fails here.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { API_PREFIX, createApp } from './app.js';
import type { AppDeps } from './deps.js';
import { permissionCheckedBy } from './middleware/permissions.js';
import { API_MOUNTS } from './routes.js';

// Building the routers never queries the database, and /health/live doesn't either
const deps: AppDeps = { db: {} as AppDeps['db'] };

interface Layer {
  handle: unknown;
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
}

interface RouteInfo {
  /** e.g. "POST /api/v1/bills/:id/cancel" */
  key: string;
  method: string;
  /** Every handler the route runs: the router's own `use` middleware first, then the route's */
  handlers: unknown[];
}

function listRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const [mountPath, build] of API_MOUNTS) {
    const stack = (build(deps) as unknown as { stack: Layer[] }).stack;
    const middleware: unknown[] = [];
    for (const layer of stack) {
      if (!layer.route) {
        middleware.push(layer.handle);
        continue;
      }
      const path = `${API_PREFIX}${mountPath}${layer.route.path === '/' ? '' : layer.route.path}`;
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({
          key: `${method.toUpperCase()} ${path}`,
          method: method.toUpperCase(),
          handlers: [...middleware, ...layer.route.stack.map((l) => l.handle)],
        });
      }
    }
  }
  return routes;
}

const ROUTES = listRoutes();

// Routes that are open, or need only a session (any role may log out or change their password)
const WITHOUT_PERMISSION = [
  'GET /api/v1/health',
  'GET /api/v1/health/live',
  'POST /api/v1/auth/login',
  'GET /api/v1/auth/me',
  'POST /api/v1/auth/change-password',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/select-branch',
];

// Every write route and the audit actions it writes (D-30); each must be asserted by some test
const WRITE_AUDITS: Record<string, string[]> = {
  'POST /api/v1/auth/login': ['auth.login', 'auth.login_failed'],
  'POST /api/v1/auth/change-password': ['auth.password_change', 'auth.password_change_failed'],
  'POST /api/v1/auth/logout': ['auth.logout'],
  'POST /api/v1/auth/select-branch': ['auth.select_branch'],
  'POST /api/v1/admin/branches/:id/import': ['branch.import'],
  'POST /api/v1/admin/branches': ['branch.create'],
  'PATCH /api/v1/admin/branches/:id': ['branch.update', 'branch.deactivate', 'branch.activate'],
  'PUT /api/v1/admin/settings': ['client_settings.update'],
  'POST /api/v1/admin/users': ['user.create'],
  'PATCH /api/v1/admin/users/:id': ['user.update', 'user.deactivate', 'user.activate'],
  'POST /api/v1/admin/users/:id/reset-password': ['user.reset_password'],
  'PUT /api/v1/admin/users/:id/branches': ['user.branches_update'],
  'POST /api/v1/bills': ['bill.create', 'customer.create', 'customer.update'],
  'POST /api/v1/bills/:id/cancel': ['bill.cancel'],
  'POST /api/v1/categories': ['category.create'],
  'PATCH /api/v1/categories/:id': ['category.update'],
  'POST /api/v1/items': ['item.create'],
  'PATCH /api/v1/items/:id': ['item.update', 'item.deactivate', 'item.activate'],
  'POST /api/v1/purchases': ['purchase.create'],
  'PUT /api/v1/purchases/:id': ['purchase.update'],
  'POST /api/v1/purchases/:id/post': ['purchase.post', 'item.update'],
  'POST /api/v1/purchases/:id/cancel': ['purchase.cancel'],
  'POST /api/v1/stock/adjustments': ['stock.adjust'],
  'POST /api/v1/vendors': ['vendor.create'],
  'PATCH /api/v1/vendors/:id': ['vendor.update', 'vendor.deactivate', 'vendor.activate'],
};

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Every audit action some test asserts with `expectAudit(db, { action: '…' })`. */
function actionsAssertedByTests(): Set<string> {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const files = [...testFiles(here), ...testFiles(join(here, '..', 'test'))].filter(
    (file) => !file.endsWith('security.test.ts'),
  );
  const asserted = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const call of text.matchAll(/expectAudit\(/g)) {
      const action = /action:\s*(['`])([^'`]+)\1/.exec(text.slice(call.index, call.index + 400));
      if (action) asserted.add(action[2]!);
    }
  }
  return asserted;
}

describe('route listing', () => {
  it('finds the routes it should (a sanity check on the listing itself)', () => {
    const keys = ROUTES.map((r) => r.key);
    expect(keys).toContain('POST /api/v1/bills');
    expect(keys).toContain('GET /api/v1/admin/reports/:report');
    expect(keys).toContain('POST /api/v1/admin/branches/:id/import');
    expect(new Set(keys).size).toBe(keys.length);
    expect(ROUTES.length).toBeGreaterThan(40);
  });
});

describe('permission checks', () => {
  it('checks a permission on every route except the open and session-only ones', () => {
    const unchecked = ROUTES.filter((r) => !r.handlers.some((h) => permissionCheckedBy(h)));
    expect(unchecked.map((r) => r.key).sort()).toEqual([...WITHOUT_PERMISSION].sort());
  });

  it('never checks a permission twice on one route (a sign of a mis-mounted router)', () => {
    const doubled = ROUTES.filter((r) => r.handlers.filter((h) => permissionCheckedBy(h)).length > 1);
    expect(doubled.map((r) => r.key)).toEqual([]);
  });
});

describe('audit coverage (D-30)', () => {
  it('names the audit actions of every write route, and of no other route', () => {
    const writes = ROUTES.filter((r) => r.method !== 'GET').map((r) => r.key);
    expect(writes.sort()).toEqual(Object.keys(WRITE_AUDITS).sort());
  });

  it('has a test asserting each of those actions with expectAudit', () => {
    const asserted = actionsAssertedByTests();
    const missing = Object.entries(WRITE_AUDITS).flatMap(([route, actions]) =>
      actions.filter((a) => !asserted.has(a)).map((a) => `${route} → ${a}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('security headers (helmet)', () => {
  it('sends helmet’s headers and hides the framework', async () => {
    const res = await request(createApp(deps)).get(`${API_PREFIX}/health/live`);
    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
