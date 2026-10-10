# Build Progress

The agent updates this file after every task (protocol step 7). Status values: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED`.

**Current phase:** 1 — Foundation (Phase 0 done 2026-10-10)

## Phase 0 — Pre-flight

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| 0.1 | Confirm Phase 1 decisions (user input) | DONE | 2026-10-10 | D-27 Node 24, D-28 Supabase dev/test, D-29 packages. DreamLand §3 updated to Node 24. |
| 0.2 | Prepare the databases | DONE | 2026-10-10 | Neon (D-28): projects `shy-cake-86251573` and `super-mouse-23963658` (check in the Neon console which one is dev), both Singapore, direct connections, default branch `production`. `.env` checked (2 different hosts, no pooler, sslmode + channel_binding params). Connection test deferred to Task 1.4. Neon's "agent prompt" (neon CLI, neon.ts, `neon deploy`) not used. |
| 0.3 | Initialise git | DONE | 2026-10-10 | Branch `main`. Added `.gitattributes` (LF everywhere): this PC has `core.autocrlf=true`, and `ops/*.sh` must have LF line endings to run on Linux. `.env` confirmed untracked. |

## Phase 1 — Foundation

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| 1.1 | Root workspace | DONE | 2026-10-10 | tsx 4.23.15, vitest 5.0.3, **typescript pinned 6.0.3**: npm installed 7.0.2, but typescript-eslint 8.71 (Task 1.3) supports only <6.1. npm 11 skipped esbuild's install script (allow-scripts); left unapproved because tsx and vitest work without it. Base tsconfig checked by compiling a probe file. |
| 1.2 | Shared package and money helpers | DONE | 2026-10-10 | 23 tests (red → green). `rupeesToPaise` uses a strict regex and integer math; `formatPaise` builds the string from integers, using Intl only for en-IN grouping (negatives like round-off show as `-₹0.40`). Changed from the plan: no `composite` (consumers use the built `dist`); split `tsconfig.json`/`tsconfig.build.json`; root `check-types`/`test` scripts added now so the gate works. Phase 1 conventions updated to match. Verified `import('@ds/shared')` by package name. |
| 1.3 | Lint and format | TODO | | |
| 1.4 | Database package | TODO | | |
| 1.5 | Backend libraries: env, logger, errors, response | TODO | | |
| 1.6 | Express app and health endpoint | TODO | | |
| 1.7 | Test database harness | TODO | | |
| 1.8 | Frontend shell | TODO | | |
| 1.9 | Root scripts and dev setup guide | TODO | | |
| 🛑 | Checkpoint 1 | TODO | | |

## Phase 2 — Access

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| 2.1 | Access tables | TODO | | |
| 2.2 | Permission map | TODO | | |
| 2.3 | Password and session service | TODO | | |
| 2.4 | Auth, permission and validation middleware | TODO | | |
| 2.5 | Auth routes | TODO | | |
| 2.6 | Audit log service | TODO | | |
| 2.7 | `setup:client` script | TODO | | |
| 2.8 | Admin API: branches and settings | TODO | | |
| 2.9 | Admin API: users and branch mapping | TODO | | |
| 2.10 | Frontend: login, branch picker, route guards | TODO | | |
| 2.11 | Frontend: Admin screens | TODO | | |
| 🛑 | Checkpoint 2 | TODO | | |

## Phase 3 — Catalog and ledger

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| 3.1 | Catalog and ledger tables | TODO | | |
| 3.2 | Stock ledger service | TODO | | |
| 3.3 | Categories API | TODO | | |
| 3.4 | Items API | TODO | | |
| 3.5 | Vendors API | TODO | | |
| 3.6 | Stock read API | TODO | | |
| 3.7 | CSV import | TODO | | |
| 3.8 | Dev seed script | TODO | | |
| 3.9 | Frontend: items, categories, vendors | TODO | | |
| 3.10 | Frontend: stock and import screens | TODO | | |
| 🛑 | Checkpoint 3 | TODO | | |

## Phase 4 — Purchases

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| 4.1 | Purchase tables | TODO | | |
| 4.2 | Purchase drafts API | TODO | | |
| 4.3 | Post a purchase | TODO | | |
| 4.4 | Cancel a purchase | TODO | | |
| 4.5 | Frontend: purchases | TODO | | |
| 🛑 | Checkpoint 4 | TODO | | |

## Phase 5 — Billing

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| 5.1 | Billing tables | TODO | | |
| 5.2 | Billing math helpers | TODO | | |
| 5.3 | Bill number allocation | TODO | | |
| 5.4 | Customer lookup | TODO | | |
| 5.5 | Create a bill | TODO | | |
| 5.6 | Cancel, list, view and receipt data | TODO | | |
| 🛑 | Checkpoint 5A — money core review | TODO | | |
| 5.7 | Billing screen I: item entry | TODO | | |
| 5.8 | Billing screen II: payment and save | TODO | | |
| 5.9 | Receipt printing | TODO | | |
| 5.10 | Bills screen | TODO | | |
| 5.11 | Counter acceptance test | TODO | | |
| 🛑 | Checkpoint 5 | TODO | | |

## Phase 6 — Adjustments and reports

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| 6.1 | Stock adjustments API | TODO | | |
| 6.2 | Day sales summary | TODO | | |
| 6.3 | Item-wise sales | TODO | | |
| 6.4 | Stock and low-stock reports | TODO | | |
| 6.5 | Purchase register | TODO | | |
| 6.6 | Report routes and visibility | TODO | | |
| 6.7 | Frontend: stock adjustment | TODO | | |
| 6.8 | Frontend: reports | TODO | | |
| 6.9 | i18n sweep | TODO | | |
| 🛑 | Checkpoint 6 | TODO | | |

## Phase 7 — Hardening

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| 7.1 | Login rate limit | TODO | | |
| 7.2 | Security review | TODO | | |
| 7.3 | Performance check | TODO | | |
| 7.4 | Backup and restore | TODO | | |
| 7.5 | Production build and deploy kit | TODO | | |
| 7.6 | Go-live rehearsal | TODO | | |
| 🛑 | Checkpoint 7 — ready for go-live | TODO | | |

## Checkpoint summaries

The agent adds one entry per checkpoint: what was built, number of tests, (proposed) items to confirm, known issues.
