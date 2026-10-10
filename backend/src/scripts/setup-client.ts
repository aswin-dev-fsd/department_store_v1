// Operator task: initialise a new client's copy with its settings and first Admin (overview §7.1).
// The logic lives here so tests can call it; setup-client.cli.ts is the thin executable.
import type { Db } from '@ds/database';
import { fullNameSchema, usernameSchema } from '@ds/shared';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { logAudit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { generateTemporaryPassword } from '../lib/temporary-password.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import * as settingsModel from '../modules/settings/settings.model.js';
import * as usersModel from '../modules/users/users.model.js';

export const setupClientSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(1, 'Enter the business name')
    .max(120, 'Use at most 120 characters'),
  adminUsername: usernameSchema,
  adminFullName: fullNameSchema,
});

export type SetupClientInput = z.infer<typeof setupClientSchema>;

export interface SetupClientResult {
  businessName: string;
  admin: { id: number; username: string; fullName: string };
  /** Shown once by the CLI, never stored or logged; the Admin must change it at first login. */
  temporaryPassword: string;
}

function alreadySetUp(): AppError {
  return new AppError(
    'ALREADY_SET_UP',
    'This database is already set up (client settings or users exist). Nothing was changed.',
  );
}

/**
 * Create the client settings and the first Admin (who must change the temporary password at
 * first login), with an audit row for each, in one transaction. Refuses — changing nothing — if
 * the database already has settings or any user, even when two runs start at once.
 */
export async function setupClient(db: Db, rawInput: SetupClientInput): Promise<SetupClientResult> {
  const input = setupClientSchema.parse(rawInput);
  const temporaryPassword = generateTemporaryPassword();
  // Before the transaction: bcrypt is deliberately slow and shouldn't hold a connection open
  const passwordHash = await hashPassword(temporaryPassword);

  return db.transaction(async (tx) => {
    if ((await usersModel.countUsers(tx)) > 0) {
      throw alreadySetUp();
    }
    // Atomic, so of two simultaneous runs exactly one gets past this line
    if (
      !(await settingsModel.insertClientSettingsIfAbsent(tx, { businessName: input.businessName }))
    ) {
      throw alreadySetUp();
    }
    const admin = await usersModel.insertUser(tx, {
      username: input.adminUsername,
      passwordHash,
      fullName: input.adminFullName,
      role: 'admin',
      mustChangePassword: true,
    });

    // No one is logged in during setup, so there is no actor (D-30)
    await logAudit(tx, {
      actorId: null,
      action: 'client_settings.create',
      entity: 'client_settings',
      entityId: 1,
      after: { businessName: input.businessName },
    });
    await logAudit(tx, {
      actorId: null,
      action: 'user.create',
      entity: 'user',
      entityId: admin.id,
      after: {
        username: input.adminUsername,
        fullName: input.adminFullName,
        role: 'admin',
        mustChangePassword: true,
      },
    });

    return {
      businessName: input.businessName,
      admin: { id: admin.id, username: input.adminUsername, fullName: input.adminFullName },
      temporaryPassword,
    };
  });
}

// ---------------------------------------------------------------------------------------
// Command line

export const SETUP_USAGE = `Usage: npm run setup:client -- --business-name "<name>" --admin-username <username> --admin-name "<full name>"

  --business-name     the client's business name, shown on screens and bills
  --admin-username    3-32 characters: letters, digits, dots, underscores or hyphens
  --admin-name        the first Admin's full name

Runs against DATABASE_URL (the root .env, or an environment variable set in your terminal).`;

/** Bad command-line arguments; \`problems\` lists everything wrong, one line each. */
export class SetupArgsError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.name = 'SetupArgsError';
    this.problems = problems;
  }
}

export type ParsedSetupArgs = { kind: 'help' } | { kind: 'run'; input: SetupClientInput };

const OPTION_FOR_FIELD = {
  businessName: '--business-name',
  adminUsername: '--admin-username',
  adminFullName: '--admin-name',
} as const;

/** Read and validate the CLI arguments (everything after the script name). */
export function parseSetupArgs(argv: string[]): ParsedSetupArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        'business-name': { type: 'string' },
        'admin-username': { type: 'string' },
        'admin-name': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    // Node's message can run on for several lines of advice; the first line is the problem
    const message = error instanceof Error ? error.message : String(error);
    throw new SetupArgsError([message.split('\n')[0] ?? message]);
  }
  if (values.help) {
    return { kind: 'help' };
  }

  const raw = {
    businessName: values['business-name'],
    adminUsername: values['admin-username'],
    adminFullName: values['admin-name'],
  };
  const missing = (Object.keys(OPTION_FOR_FIELD) as (keyof typeof OPTION_FOR_FIELD)[])
    .filter((field) => raw[field] === undefined)
    .map((field) => `${OPTION_FOR_FIELD[field]} is required`);
  if (missing.length > 0) {
    throw new SetupArgsError(missing);
  }

  const parsed = setupClientSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SetupArgsError(
      parsed.error.issues.map((issue) => {
        const field = issue.path[0] as keyof typeof OPTION_FOR_FIELD;
        return `${OPTION_FOR_FIELD[field]}: ${issue.message}`;
      }),
    );
  }
  return { kind: 'run', input: parsed.data };
}
