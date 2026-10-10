// Executable for reset-password.ts: npm run reset-password -- --username admin
// Plain ASCII output, so it reads correctly in any Windows terminal.
import { describeConnection } from '@ds/database';
import { env } from '../config/env.js';
import { db, pool } from '../db.js';
import { AppError } from '../lib/errors.js';
import { CliUsageError, fail, out } from './cli.js';
import { parseResetArgs, RESET_USAGE, resetPasswordForUsername } from './reset-password.js';

/** Run the reset and return the process exit code: 0 done, 1 failed or unknown user, 2 bad arguments. */
async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseResetArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError) {
      for (const problem of error.problems) fail(`ERROR: ${problem}`);
      fail();
      fail(RESET_USAGE);
      return 2;
    }
    throw error;
  }
  if (parsed.kind === 'help') {
    out(RESET_USAGE);
    return 0;
  }

  // Say where it is about to write, so running it against the wrong database is obvious
  out(`Database: ${describeConnection(env.DATABASE_URL)}`);
  try {
    const result = await resetPasswordForUsername(db, parsed.input);
    out();
    out(`OK: password reset for ${result.username} (${result.fullName})`);
    if (!result.isActive) {
      out('  NOTE: this account is deactivated. It cannot log in until an Admin reactivates it.');
    }
    out();
    out('  Temporary password. It is shown only now; write it down. The user logs in with it');
    out('  and is asked to choose a new one. Their other sessions have ended:');
    out();
    out(`    ${result.temporaryPassword}`);
    out();
    return 0;
  } catch (error) {
    fail(
      error instanceof AppError
        ? `ERROR: ${error.message}`
        : `ERROR: reset failed: ${error instanceof Error ? error.message : error}`,
    );
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
