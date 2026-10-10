# Phase 2 — Access

**Goal:** people can log in. An Admin sets up branches, users and cashier–branch mapping. Every route is protected by permission and scoped to the active branch.

**Read first for the whole phase:** overview §3 (users and roles), §4.7 (security), §7.1–7.2 (go-live and login workflows); D-04, D-10.

**Settled conventions:** session cookie name `ds_session`; temporary passwords force a change at next login.

---

## Task 2.1 — Access tables

**Goal:** the access tables exist in both databases.

**Read first:** `docs/implementation_plan.md` → Data model; overview §5.2 "Setup and access" and `audit_logs`.

**Files:** `database/src/schema/access.ts`, `database/src/schema/audit.ts`, `database/src/schema/index.ts`, a generated migration in `database/migrations/`

**Steps:**
1. Define the tables:
   - `client_settings`
   - `branches`
   - `users` — include `must_change_password` (boolean, default false), `is_active`, `last_login_at`
   - `user_branches` — composite primary key `(user_id, branch_id)`
   - `sessions` — `token_hash` unique, index on `user_id`
   - `audit_logs` — `before` and `after` as `jsonb`
2. Use a `pgEnum` `user_role` with values `admin` and `cashier`.
3. Add `created_at` to every table, and `updated_at` to editable tables (overview §5.2).
4. `npm run db:generate`, then **read the generated SQL** and check it against the overview. Apply it with `npm run db:migrate` to dev; the test harness applies it to test.
5. Recreate the test database from empty and run `npm test` to prove the migration applies cleanly.

**Done when:**
- [ ] The migration applies to an empty database without errors
- [ ] `npm run check-types` passes
- [ ] The tables match overview §5.2

**Commit:** `feat(database): add access and audit tables`

---

## Task 2.2 — Permission map

**Goal:** one tested source of truth for which role has which permission.

**Read first:** overview §3 → Permission matrix.

**Files:** `shared/src/permissions.ts`, `shared/src/permissions.test.ts`, `shared/src/index.ts`

**Steps:**
1. **Red** — a table-driven test that mirrors the overview matrix row by row: for every permission × role, `can(role, permission)` is true or false exactly as the matrix shows.
2. **Green** — `PERMISSIONS` as a `const` array; type `Permission`; type `Role = 'admin' | 'cashier'`; `ROLE_PERMISSIONS: Record<Role, readonly Permission[]>`; `can(role, permission)`.

**Done when:**
- [ ] The test covers every cell of the matrix and passes

**Commit:** `feat(shared): add role permission map`

---

## Task 2.3 — Password and session service

**Goal:** passwords are hashed, and sessions can be created, verified and ended.

**Read first:** overview §4.7 (Passwords, Sessions rows).

**Files:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.service.test.ts`

**Steps:**
1. Install `bcrypt`, `@types/bcrypt`.
2. **Red** — tests:
   - `hashPassword` and `verifyPassword` round-trip; a wrong password fails.
   - `createSession` returns a raw token; the database stores only its SHA-256 hash.
   - `verifySession(token)` returns the user and active branch.
   - `verifySession` throws `AuthError` for an unknown token, an expired session, or an inactive user.
   - `deleteSession` and `deleteUserSessions(userId)` remove rows.
3. **Green** — implement:
   - bcrypt cost 12.
   - Token: 32 random bytes from `crypto.randomBytes`, base64url.
   - `expires_at = now + env.SESSION_TTL_HOURS`.
   - `verifySession` updates `last_seen_at`.

**Done when:**
- [ ] All tests pass
- [ ] No raw token or password is written to the database or the logs

**Commit:** `feat(auth): add password hashing and session service`

---

## Task 2.4 — Auth, permission and validation middleware

**Goal:** reusable middleware for "who is calling", "may they do this", "in which branch", and "is the input valid".

**Read first:** overview §4.5 (lifecycle); `AGENTS.md` → Branch-scoped data, Permissions.

**Files:**
- `backend/src/middleware/auth.ts`, `permissions.ts`, `validate.ts`
- `backend/src/lib/branch-scope.ts`
- `backend/src/types/express.d.ts` — `req.ctx`
- `backend/src/middleware/middleware.test.ts`

**Steps:**
1. Install `cookie-parser`, `@types/cookie-parser`, and register it in `createApp()`.
2. **Red** — tests, using a small test router:
   - No cookie → 401.
   - Valid cookie → `req.ctx = { user, activeBranchId }`.
   - `requirePermission('bill:create')` as Admin → 403 `FORBIDDEN`.
   - `requireBranch` for a cashier with no active branch → 403 `NO_ACTIVE_BRANCH`.
   - `validate({ body: schema })` with bad input → 422 with `details`.
3. **Green** — implement the middleware.
   - `branch-scope.ts` exports `activeBranchId(req)`, which returns the branch or throws `ForbiddenError`.
   - It also exports a short documented pattern for branch-scoped Drizzle queries, e.g. `where(and(eq(table.branchId, branchId), …))`.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(auth): add auth, permission, branch and validation middleware`

---

## Task 2.5 — Auth routes

**Goal:** login, logout, me, change-password and select-branch work end to end.

**Read first:** overview §7.2, §8 (auth endpoints); D-10.

**Files:**
- `shared/src/schemas/auth.ts`
- `backend/src/modules/auth/auth.routes.ts`, `auth.controller.ts`, `auth.routes.test.ts`

**Steps:**
1. **Red** — Supertest tests:
   - **Login:** success sets an httpOnly `ds_session` cookie (`Secure` when `COOKIE_SECURE`; SameSite `lax`).
   - **Login failure:** a wrong password, unknown user, or inactive user all return the **same** 401 message: "Invalid username or password".
   - **Login, active branch:** a cashier with exactly one branch gets that branch as active automatically. A cashier with several gets none (`needsBranchSelection: true`). The Admin gets none.
   - **`me`:** returns the user, role, permissions, branches, active branch and `mustChangePassword`.
   - **`select-branch`:** an unmapped branch → 403.
   - **`change-password`:** a wrong current password → 401. Success clears `must_change_password` and ends the user's **other** sessions.
   - **`logout`:** deletes the session and clears the cookie.
   - **Audit (D-30):** `auth.login`, `auth.login_failed` (with the attempted username, never the password, and no actor), `auth.logout`, `auth.password_change` each write a row. Use `expectAudit` from Task 2.6. *If 2.5 runs before 2.6, add these assertions in 2.6.*
2. **Green** — implement. Set `last_login_at` on login.
3. **Notes from Task 2.3:**
   - Password fields in the zod schemas: at most 72 **bytes** (`PASSWORD_MAX_BYTES`; bcrypt ignores anything longer), measured in bytes, not characters.
   - After deploying, time a login on staging. bcrypt cost 12 took ~0.7 s on the dev PC, and Render Free has 0.1 CPU. If it's over ~2 s there, record it and let the user decide (keep 12, or make the cost configurable); production hardware decides the final value.
   - **Measured in Task 2.5:** median 2.08 s through Vercel (1.6–2.4 s; 1.78 s direct to Render) vs ~0.4 s locally. Slightly over the line, so it is a decision at Checkpoint 2.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(auth): add login, logout, me, change-password and select-branch`

---

## Task 2.6 — Audit log service

**Goal:** every change and login event can be recorded with secrets removed (D-30).

**Read first:** D-30; overview §4.7 (Audit log row); `AGENTS.md` → Audit.

**Files:** `backend/src/lib/audit.ts`, `backend/src/lib/audit.test.ts`, `backend/test/helpers/audit.ts` (an `expectAudit(db, { action, entity, entityId })` assertion that later tasks use to prove each write is audited)

**Steps:**
1. **Red** — tests:
   - `logAudit(tx, { actorId, branchId, action, entity, entityId, before, after, ip })` writes a row. Actions are verb-style strings such as `item.update`, `bill.cancel`, `auth.login_failed`.
   - Keys matching `/password|token|secret|hash/i` are replaced with `"[redacted]"` at any depth.
   - It runs inside the caller's transaction, so a rollback leaves no audit row.
2. **Green** — implement.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(audit): add audit log service with redaction`

---

## Task 2.7 — `setup:client` script

**Goal:** a new client's copy can be initialised with client settings and its first Admin.

**Read first:** overview §7.1 step 2, §3 "Account lifecycle".

**Files:**
- `backend/src/scripts/setup-client.ts` (logic, exported and tested) and `setup-client.cli.ts` (the thin executable) + tests
- `backend/src/lib/temporary-password.ts` + test — reused by Task 2.9
- `shared/src/schemas/users.ts` + test — `usernameSchema`, `fullNameSchema`, extended in Task 2.9
- `backend/src/modules/users/users.model.ts`, `backend/src/modules/settings/settings.model.ts` — the queries, extended in Tasks 2.8 and 2.9
- Scripts: root and backend `setup:client`

**Steps:**
1. **Red** — tests on the exported function `setupClient({ businessName, adminUsername, adminFullName })`:
   - It creates the `client_settings` row and an Admin with `must_change_password = true`, and returns a temporary password.
   - A second run refuses with a clear message and changes nothing — also when two runs start at the same moment.
2. **Green** — implement:
   - The temporary password is 16 random characters without look-alikes.
   - The CLI wrapper takes `--business-name`, `--admin-username`, `--admin-name` and prints the temporary password **once** — never logged anywhere else.
   - Write audit rows (`client_settings.create`, `user.create`; no actor, no password).
3. **Notes from Task 2.7:**
   - The audit redaction hid `mustChangePassword` (its name contains "password"), so password-change rows had lost their before/after values. Fixed: true/false values are never redacted. The Task 2.5 password-change test now asserts the values.
   - Verification ran on the **test** database, with the password masked, so no credential entered the chat. The user runs the script on the dev database (and on staging) in their own terminal — commands in `docs/dev-setup.md`.

**Done when:**
- [x] The tests pass
- [x] `npm run setup:client -- --business-name "Demo Stores" --admin-username admin --admin-name "Admin"` works (checked on the test database from Git Bash and PowerShell)
- [ ] The user has run it on their dev database *(not blocking)*

**Commit:** `feat(setup): add setup-client script for the first admin`

---

## Task 2.8 — Admin API: branches and settings

**Goal:** the Admin can manage branches and client settings.

**Read first:** overview §5.2 (`branches`, `client_settings` rules), §8 (admin endpoints).

**Files:**
- `shared/src/schemas/branches.ts`, `shared/src/schemas/settings.ts`
- `backend/src/modules/branches/branches.{routes,controller,service,test}.ts`
- `backend/src/modules/settings/settings.{routes,controller,service,test}.ts`

**Steps:**
1. **Red** — tests:
   - A cashier gets 403 on every admin route.
   - Create a branch: `code` must be 1–3 capital letters A–Z and unique; a duplicate → 400 `DUPLICATE_CODE`.
   - Edit a branch, deactivate a branch, list with `limit`/`offset`.
   - Get and update settings.
   - Every change writes an audit row.
2. **Green** — implement.
3. Leave a `TODO(5.6)` comment where the branch-code edit happens: "code becomes fixed once the branch has bills". Task 5.6 adds that rule.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(admin): add branch and settings management`

---

## Task 2.9 — Admin API: users and branch mapping

**Goal:** the Admin can manage users, reset passwords, and map cashiers to branches.

**Read first:** overview §3 (mapping, account lifecycle), §8.

**Files:**
- `shared/src/schemas/users.ts` — already holds `usernameSchema` and `fullNameSchema` (Task 2.7); add the create/edit schemas
- `backend/src/modules/users/users.{routes,controller,service,test}.ts`, and extend `users.model.ts` (already has `countUsers`, `insertUser`)
- Reuse `generateTemporaryPassword` from `backend/src/lib/temporary-password.ts`
- `backend/src/scripts/reset-password.ts` + `.cli.ts` + test, root script `reset-password`

**Steps:**
1. **Red** — tests:
   - Create a user: unique username; role `admin` or `cashier`; returns a temporary password once; `must_change_password = true`.
   - Edit `full_name`.
   - Deactivate: ends the user's sessions, and their next request gets 401.
   - Reset password: new temporary password, sessions ended.
   - `PUT /admin/users/:id/branches`: only for cashiers; only active branches; replaces the whole mapping.
   - Audit rows are written, and contain no passwords.
2. **Green** — implement.
3. **Operator recovery:** if the only Admin loses their password there is no one to reset it, and `setup:client` refuses to run again. Add `npm run reset-password -- --username <name>`, built like `setup-client` (logic + thin CLI): sets a new temporary password (printed once), sets `must_change_password`, ends that user's sessions, writes an audit row. Test it, and document it in `docs/dev-setup.md`.

**Done when:**
- [ ] All tests pass
- [ ] A lost Admin password can be recovered with `reset-password`

**Commit:** `feat(admin): add user management, branch mapping and reset-password script`

---

## Task 2.10 — Frontend: login, branch picker, route guards

**Goal:** the login flow works in the browser for both roles.

**Read first:** overview §7.2, §4.6.

**Files:**
- `frontend/src/auth/` — `useMe`, `useLogin`, `useLogout`, `AuthProvider`
- `frontend/src/pages/LoginPage.tsx`, `ChangePasswordPage.tsx`, `BranchPickerPage.tsx`
- `frontend/src/components/RequirePermission.tsx`
- `frontend/src/components/AppShell.tsx` — nav items filtered by permission
- `frontend/src/i18n/en.ts`

**Steps:**
1. Routing rules:
   - Not logged in → Login.
   - `mustChangePassword` → Change password; nothing else is reachable.
   - Cashier with `needsBranchSelection` → Branch picker.
   - Admin → Admin home. Cashier → Billing placeholder.
2. `RequirePermission` hides a route when `can(role, perm)` is false, using the shared permission map.
3. The shell header shows the user, active branch, a branch switch (if several branches) and logout.
4. Form validation uses the zod schemas from `@ds/shared`. All text goes through `t()`.

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check: admin login; cashier login with one branch; with two branches (picker); forced password change; logout
- [ ] **On staging**, the user logs in at https://dept-store-staging.vercel.app with an Admin created by running `setup:client` against the staging database (commands in `docs/dev-setup.md`), then reloads the page and is still logged in. That proves the httpOnly cookie survives Vercel's `/api` rewrite, which Task 2.5 couldn't check without a user. The user types the password; it never goes into the chat.

**Commit:** `feat(frontend): add login, branch picker and route guards`

---

## Task 2.11 — Frontend: Admin screens

**Goal:** the Admin can do all of Phase 2's setup from the browser.

**Files:** `frontend/src/pages/admin/BranchesPage.tsx`, `UsersPage.tsx`, `SettingsPage.tsx`, related components, `en.ts`

**Steps:**
1. **Branches:** list, create, edit, deactivate.
2. **Users:** list, create (show the temporary password once, with a copy button), edit, deactivate, reset password, and branch mapping with a checkbox per branch for cashiers.
3. **Settings:** form for the client settings.
4. Show server errors from `ApiError` next to the relevant field, or as a message.

**Done when:**
- [ ] check-types and build pass
- [ ] Manual check: everything in the Checkpoint 2 review below works

**Commit:** `feat(frontend): add admin screens for branches, users and settings`

---

## 🛑 Checkpoint 2

Agent: follow the checkpoint steps in `README.md`.

**Checkpoint review (user):**
- [ ] Run `setup:client` and log in as the Admin with the temporary password; you must change it
- [ ] Create two branches and two cashiers; map one cashier to both branches
- [ ] Log in as each cashier: the single-branch cashier goes straight in; the other sees the picker
- [ ] Deactivate a cashier while they're logged in: their next action logs them out
- [ ] Confirm the (proposed) items listed in the summary: 12-hour sessions, forced password change after a reset, minimum password length 8, bcrypt cost 12 (login ≈ 2 s on Render Free), username rule (3–32 characters: lowercase letters, digits, `.` `_` `-`)
- [ ] Check the `ip` recorded for failed logins on staging is your own public IP (query in `progress.md`, Task 2.5); if not, `TRUST_PROXY` must change
