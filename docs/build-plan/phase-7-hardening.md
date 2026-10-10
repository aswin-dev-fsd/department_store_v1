# Phase 7 — Hardening

**Goal:** the app is safe, fast enough, backed up, and deployable. Pending decisions that block go-live are settled.

**Read first for the whole phase:** overview §4.7 (security), §13 (operations and go-live), §14 (risks); PD-01, PD-03, PD-04.

**Before this phase starts:** PD-03 (hosting) must be decided, because Tasks 7.4–7.6 depend on it. PD-01 (GST) must be decided before go-live. If GST applies, it gets its own phase file (`phase-8-gst.md`), written as a plan when PD-01 is decided.

---

## Task 7.1 — Login rate limit

**Goal:** password guessing is slowed down.

**Files:** `backend/src/middleware/rateLimit.ts`, `backend/src/modules/auth/auth.routes.ts`, `rateLimit.test.ts`

**Steps:**
1. Install `express-rate-limit`.
2. **Red** — tests: after **(proposed)** 10 failed logins in 15 minutes for one IP + username → 429 `TOO_MANY_ATTEMPTS` in the standard envelope. A successful login isn't counted. Other users aren't affected.
3. **Green** — implement. Configure Express `trust proxy` for running behind Nginx.

**Done when:**
- [ ] All tests pass

**Commit:** `feat(auth): add login rate limit`

---

## Task 7.2 — Security review

**Goal:** every measure in overview §4.7 is verified, and any gaps are fixed.

**Files:** `docs/security-checklist.md`, plus fixes wherever gaps are found (each fix with a test)

**Steps:**
1. Write `security-checklist.md`, one row per item, each with how it was verified (test name or manual step):
   - Cookie flags in production
   - CORS has no wildcard
   - Helmet headers present
   - No request bodies or secrets in the logs — a test captures log output during a login
   - Sessions expire; expired sessions are cleaned up — add the cleanup on login, or as a daily task in the server
   - Deactivation ends sessions
   - Every write route has a permission check — a test lists all routes and checks each has `requirePermission`
   - Every branch-owned query is branch-scoped — a cross-branch test exists for every resource
   - The audit log covers every action listed in overview §4.7
   - `npm audit` shows no high or critical issues
2. Fix each gap in its own commit.

**Done when:**
- [ ] Every row in the checklist is verified
- [ ] The gate passes

**Commit:** `docs(security): add verified security checklist` (plus a `fix(...)` commit per gap)

---

## Task 7.3 — Performance check

**Goal:** the counter stays fast with a realistic amount of data.

**Files:** `backend/src/scripts/seed-volume.ts`, `docs/performance.md`, index migrations if needed

**Steps:**
1. `seed-volume.ts` creates 20,000 items in a branch and 100,000 bills spread over a year.
   - This volume can exceed the Neon free plan's per-project storage. Run it on a temporary database: a local PostgreSQL, or a short-lived paid database in the production region, deleted afterwards.
   - Measuring in the production region also gives realistic timings; Singapore timings overstate the delay for a Mumbai server.
2. Measure and record in `performance.md`. **(Proposed)** targets:

   | Action | Target |
   |---|---|
   | Item lookup by barcode | < 100 ms |
   | Name search | < 300 ms |
   | Bill save (10 lines) | < 300 ms |
   | Day summary | < 1 s |
   | Item-wise sales for 1 month | < 2 s |

3. For anything slow: `EXPLAIN ANALYZE`, add an index through a migration, and measure again.

**Done when:**
- [ ] Every target is met, or the gap is explained in `performance.md` and accepted by the user at the checkpoint

**Commit:** `perf(db): add volume seed, measurements and indexes`

---

## Task 7.4 — Backup and restore

**Goal:** daily backups exist, and a restore has actually been tested.

**Read first:** PD-03; overview §13.2.

**Files:** `ops/backup.sh`, `ops/restore.sh`, `docs/backup-restore.md`

**Steps:**
1. `backup.sh`: `pg_dump -Fc` to a timestamped file; keeps the last N files (retention from PD-03); copies the file to the storage chosen in PD-03, outside the database provider; exits non-zero on any failure.
   - Run it on the app server. Install the PostgreSQL client tools there, matching the database's major version.
   - Managed providers (Supabase, Neon) have their own backups too. This script is an independent copy that we control.
2. `restore.sh`: restores a chosen file into a named database. It refuses to overwrite the production database unless a `--force` flag is given.
3. Test both: back up the dev database, restore it into a scratch database, and compare row counts of every table.
4. `backup-restore.md`: schedule (cron), retention, where backups live, the restore steps, and the date of the last restore test.

**Done when:**
- [ ] A restore into a scratch database matches the source row counts, recorded in the doc

**Commit:** `chore(ops): add backup and restore scripts`

---

## Task 7.5 — Production build and deploy kit

**Goal:** the app can be deployed to the server chosen in PD-03, following a written runbook.

**Files:** root `build` script, `ecosystem.config.cjs` (PM2), `ops/nginx.conf.example`, `docs/deploy.md`

**Steps:**
1. `npm run build` produces the backend `dist` and the frontend `dist`.
2. PM2: one app (`node backend/dist/server.js`) with production env and log rotation.
3. Nginx example:
   - HTTPS
   - serves `frontend/dist`, with a single-page-app fallback to `index.html`
   - proxies `/api` to the backend
   - sensible `client_max_body_size` for CSV import (5 MB)
4. `deploy.md`, step by step for a new client:
   1. Server setup (from PD-03)
   2. Database
   3. `.env`
   4. Build
   5. Migrate
   6. `setup:client`
   7. PM2
   8. Nginx and SSL
   9. Backup cron
   10. Smoke test with `/api/v1/health`

   Plus an "updating to a new version" section: pull, build, migrate, `pm2 reload`.

**Done when:**
- [ ] A deploy to a staging server (or a local Linux VM/WSL) following only `deploy.md` succeeds, and health returns `ok`

**Commit:** `chore(ops): add production build, pm2, nginx and deploy runbook`

---

## Task 7.6 — Go-live rehearsal

**Goal:** a full dry run of overview §13.3 on the real server, with the client's real data, before the actual go-live.

**Files:** `docs/go-live-<client>.md` — a copy of the overview §13.3 checklist with results

**Steps:**
1. The agent prepares the checklist file and the import CSVs, validated with a dry-run import into staging.
2. The user and agent work through every line: fresh deploy, `setup:client`, branches, users, import, stock check against shelves, printer test at every counter, backup and restore, backup internet.
3. Record any problems and fix them, each with a test.

**Done when:**
- [ ] Every checklist line passes
- [ ] PD-01, PD-03 and PD-04 are all Decided

**Commit:** `docs(go-live): add go-live rehearsal results`

---

## 🛑 Checkpoint 7 — ready for go-live

Agent: follow the checkpoint steps in `README.md`. The summary also lists every remaining (proposed) item and every open PD.

**Checkpoint review (user):**
- [ ] The go-live rehearsal file is fully green
- [ ] The security checklist and performance results are reviewed
- [ ] Set the go-live date
