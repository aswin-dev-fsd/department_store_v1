# Build Plan — How to Run It

A step-by-step plan for building v1 with an AI agent (Claude Code, Google Antigravity, or similar). The work is split into small tasks. Each task ends with checks that must pass before the next one starts, and each phase ends with a human review.

## Files

| File | Use |
|---|---|
| [progress.md](progress.md) | Status of every task. The agent reads it to find where to resume and updates it after every task. |
| [phase-0-preflight.md](phase-0-preflight.md) | Decisions, database, and git — before any code |
| [phase-1-foundation.md](phase-1-foundation.md) | Monorepo, shared libraries, health endpoint, test harness, frontend shell |
| [phase-2-access.md](phase-2-access.md) | Login, sessions, permissions, Admin setup screens |
| [phase-3-catalog-ledger.md](phase-3-catalog-ledger.md) | Items, categories, vendors, the stock ledger, CSV import |
| [phase-4-purchases.md](phase-4-purchases.md) | Purchase entry: draft → post → cancel |
| [phase-5-billing.md](phase-5-billing.md) | The billing counter, bill numbers, receipts |
| [phase-6-adjustments-reports.md](phase-6-adjustments-reports.md) | Stock adjustments, the four reports, i18n sweep |
| [phase-7-hardening.md](phase-7-hardening.md) | Security, performance, backups, deploy kit |

References in tasks: "overview §7.3" means section 7.3 of [../project-overview.md](../project-overview.md); "D-15" and "PD-01" are in [../pending-decisions.md](../pending-decisions.md).

## Start prompt

Paste this at the start of every session:

> Read `AGENTS.md` and `docs/build-plan/README.md`. Then do the next task in `docs/build-plan/progress.md`, following the agent protocol. Stop after that one task and report.

To let the agent run several tasks in a row, replace the last sentence with:

> Continue task by task until the next 🛑 CHECKPOINT. Stop immediately if any check fails.

Start a **fresh session at the beginning of each phase**, so old context doesn't crowd out the current task.

For Google Antigravity: use `progress.md` as the task list instead of a separate `task.md`, and write the per-task plan (protocol step 3) in chat.

## Agent protocol

Follow these steps for every task, in order.

1. **Orient.** Read `progress.md`. The next task is the first one that isn't DONE. Open its phase file and read the task and every file in its "Read first" list.
2. **Check the gate is open.** If the task depends on a decision still pending in `docs/pending-decisions.md`, or on a task that isn't DONE, mark it BLOCKED in `progress.md` with the reason, and stop.
3. **State the plan.** Before editing, write in chat: the task ID, the files you will create or change, and how you will verify. A few lines.
4. **Red.** Where the task lists tests, write them first and run them. They must fail for the expected reason.
5. **Green.** Implement until those tests pass. Change only the files the task names, plus their tests. If a change elsewhere is needed, report it rather than making it.
6. **Run the gate.** `npm run verify` (lint, format check, type check, all tests; available from Task 1.9) — all green. Then confirm each "Done when" item by actually running or checking it.
7. **Record.** In `progress.md`, set the task to DONE with today's date and a one-line note (anything surprising, any follow-up). If a doc is now out of date, update it in the same change.
8. **Commit.** One commit per task, using the message in the task (DreamLand §10 format).
9. **Report and stop.** In chat: what was done, test results, and anything the user should know.

### When something goes wrong

- **A check fails:** fix it within the task. After two failed attempts at the same problem, stop and report with the error output.
- **The task is unclear or looks wrong:** stop, explain, and propose a fix.
- **A detail is marked (proposed)** in the overview: build it as described, and list it at the next checkpoint for the user to confirm.
- **A package outside the approved list is needed** ([../implementation_plan.md](../implementation_plan.md#packages-approved-with-this-plan)): stop and ask (DreamLand §3). `@types/*` packages for approved packages count as approved once Task 0.1 confirms that rule.

## 🛑 CHECKPOINT

A checkpoint ends every phase; Phase 5 has an extra one mid-way. At a checkpoint the agent:

1. Runs the full gate from a clean install: delete every `dist/`, then `npm ci` and `npm run verify`.
2. Writes a phase summary in `progress.md`: what was built, the number of tests, **(proposed)** items that need the user's confirmation, and known issues.
3. Stops. The next phase starts only when the user says go.

The user, at a checkpoint: works through the phase's "Checkpoint review" list, skims the changes, and answers any questions.

## Why this works

- **Small tasks** keep each change easy to review and easy to undo.
- **Tests written first** define "done" before the code exists.
- **The gate after every task** catches a mistake in the task that caused it, not three tasks later.
- **`progress.md` holds the state**, so any session — or a different AI tool — resumes exactly where the last one stopped.
- **Checkpoints** put a human review where it matters: before more work is built on top.

## Task format

Every task in the phase files has the same parts:

| Part | Meaning |
|---|---|
| **Goal** | One sentence: what exists after the task |
| **Read first** | Docs and code to read before starting |
| **Files** | What to create or change; nothing else |
| **Steps** | In order. "Red" steps are tests written before the code |
| **Done when** | Checkable conditions; all must be true |
| **Commit** | The commit message |

When adding a task, use the same parts and add a row for it in `progress.md`.
