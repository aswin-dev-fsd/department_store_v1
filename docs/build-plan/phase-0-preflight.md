# Phase 0 — Pre-flight

**Goal:** every decision and tool Phase 1 needs is in place. No application code in this phase.

Machine check on 2026-10-10: Node.js 24.19.0, npm 11.17.0 and git 2.55 are installed. PostgreSQL client tools (`psql`, `pg_dump`) and Docker are **not** installed. The user plans a cloud database (Supabase or Neon), so no local PostgreSQL is needed for Phases 0–6.

---

## Task 0.1 — Confirm Phase 1 decisions (user input)

**Goal:** the open questions that block Phase 1 are answered and recorded.

**Read first:** `docs/pending-decisions.md` (PD-03, PD-05), `docs/implementation_plan.md` (Packages).

**Files:** `docs/pending-decisions.md`, `docs/implementation_plan.md`

**Steps:**
1. Ask the user these three questions in one message, each with the recommendation:
   1. **Node.js version (PD-05).** Recommend Node 24 LTS, which is already installed. Also ask whether to update DreamLand §3 for all projects; the user edits that file themselves.
   2. **Database for development and tests: Supabase or Neon.** Both work, because the app uses plain PostgreSQL through Drizzle.
      - **Neon** (recommended for dev/test): one project with two branches, `dev` and `test`; free tier; Singapore region.
      - **Supabase:** two free projects in Mumbai. Free projects pause after 7 days with little activity.

      The production database is a separate decision (PD-03).
   3. **Extra packages:**
      - `@tailwindcss/vite`, which Tailwind v4 needs with Vite
      - `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier` — lint and format, recommended for AI-written code
      - The rule that `@types/*` packages for an approved package count as approved
2. Wait for the answers.
3. Record them:
   - Move PD-05 to Decided as **D-27**.
   - Add the dev/test database choice as **D-28**.
   - Add the approved packages to the Packages table in `implementation_plan.md`.
   - If lint is declined, mark Task 1.3 as skipped in `progress.md` and drop `npm run lint` from the gate in `README.md`.

**Done when:**
- [ ] All three questions are answered by the user
- [ ] D-27 and D-28 are recorded, and the packages table is updated

**Commit:** none — git starts in Task 0.3.

---

## Task 0.2 — Prepare the databases

**Goal:** two empty PostgreSQL databases exist and are reachable: one for development, one for automated tests.

**Read first:** D-28.

**Files:** `.env` at the project root (never committed). Phase 1 adds `.env.example` and checks that `.env` is ignored by git.

**Steps:**
1. The user creates two Neon projects in the Neon console: `dept-store-dev` and `dept-store-test`, both on AWS in Singapore (`aws-ap-southeast-1`), with the latest Postgres version offered. The agent gives click-by-click guidance but never handles the user's account login.
2. For each project, the user opens **Connect**, turns **Connection pooling off** (direct connection), and copies the connection string into the root `.env`:
   ```
   DATABASE_URL=<dev connection string>
   TEST_DATABASE_URL=<test connection string>
   ```
   The connection strings contain passwords, so the user pastes them; the agent doesn't repeat them in chat.
3. Connection checks run in Task 1.4 (`npm run db:check`), because `psql` isn't installed.

**Done when:**
- [ ] Both databases exist
- [ ] Both connection strings are in `.env`, entered by the user
- [ ] The two strings point to **different** databases

**Commit:** none.

---

## Task 0.3 — Initialise git

**Goal:** the project is a git repository, and the docs are the first commit.

**Files:** `.gitignore`

**Steps:**
1. `git init -b main`
2. Create `.gitignore` with: `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*` (but keep `!.env.example`), `*.log`, `.DS_Store`, `.vite/`.
3. Check that `git status` does **not** list `.env`.
4. Commit everything (the docs, `AGENTS.md`, `.gitignore`).

**Done when:**
- [ ] `git log` shows one commit
- [ ] `git status` is clean
- [ ] `.env` is not tracked (`git ls-files .env` prints nothing)

**Commit:** `docs(project): add project overview, decisions and build plan`
