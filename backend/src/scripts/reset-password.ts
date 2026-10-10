// Operator recovery task: give a user a new temporary password from the command line. It is for
// when nobody can use the Admin screens, e.g. the only Admin lost the password before first login
// (setup:client refuses to run twice). The logic lives here so tests can call it;
// reset-password.cli.ts is the thin executable.
import type { Db } from '@ds/database';
import { usernameSchema } from '@ds/shared';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import * as usersModel from '../modules/users/users.model.js';
import { resetUserPassword } from '../modules/users/users.service.js';
import { CliUsageError } from './cli.js';

export const resetPasswordSchema = z.object({ username: usernameSchema });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export interface ResetPasswordResult {
  username: string;
  fullName: string;
  /** A deactivated account is reset too, but cannot log in until an Admin reactivates it. */
  isActive: boolean;
  /** Shown once by the CLI, never stored or logged; the user must change it at next login. */
  temporaryPassword: string;
}

/**
 * Set a new temporary password for `username` (any letter case), end all their sessions and
 * require a change at next login, with an audit row (no actor: an operator ran it). An unknown
 * username answers USER_NOT_FOUND and changes nothing.
 */
export async function resetPasswordForUsername(
  db: Db,
  rawInput: ResetPasswordInput,
): Promise<ResetPasswordResult> {
  const { username } = resetPasswordSchema.parse(rawInput);
  const user = await usersModel.findUserByUsername(db, username);
  if (!user) {
    throw new AppError('USER_NOT_FOUND', `There is no user named "${username}"`);
  }
  const { temporaryPassword } = await resetUserPassword(db, user.id, null, null);
  return {
    username: user.username,
    fullName: user.fullName,
    isActive: user.isActive,
    temporaryPassword,
  };
}

// ---------------------------------------------------------------------------------------
// Command line

export const RESET_USAGE = `Usage: npm run reset-password -- --username <username>

  --username    the account to reset (any letter case)

Prints a new temporary password once. The user must change it at their next login, and all
their current sessions end. Runs against DATABASE_URL (the root .env, or an environment
variable set in your terminal).`;

export type ParsedResetArgs = { kind: 'help' } | { kind: 'run'; input: ResetPasswordInput };

/** Read and validate the CLI arguments (everything after the script name). */
export function parseResetArgs(argv: string[]): ParsedResetArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        username: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    // Node's message can run on for several lines of advice; the first line is the problem
    const message = error instanceof Error ? error.message : String(error);
    throw new CliUsageError([message.split('\n')[0] ?? message]);
  }
  if (values.help) {
    return { kind: 'help' };
  }
  if (values.username === undefined) {
    throw new CliUsageError(['--username is required']);
  }
  const parsed = resetPasswordSchema.safeParse({ username: values.username });
  if (!parsed.success) {
    throw new CliUsageError(parsed.error.issues.map((issue) => `--username: ${issue.message}`));
  }
  return { kind: 'run', input: parsed.data };
}
