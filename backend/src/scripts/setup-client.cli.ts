// Executable for setup-client.ts: npm run setup:client -- --business-name "..." --admin-username ... --admin-name "..."
// Plain ASCII output, so it reads correctly in any Windows terminal.
import { describeConnection } from '@ds/database';
import { env } from '../config/env.js';
import { db, pool } from '../db.js';
import { AppError } from '../lib/errors.js';
import { CliUsageError, fail, out } from './cli.js';
import { parseSetupArgs, SETUP_USAGE, setupClient } from './setup-client.js';

/** Run the setup and return the process exit code: 0 done, 1 failed or already set up, 2 bad arguments. */
async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseSetupArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError) {
      for (const problem of error.problems) fail(`ERROR: ${problem}`);
      fail();
      fail(SETUP_USAGE);
      return 2;
    }
    throw error;
  }
  if (parsed.kind === 'help') {
    out(SETUP_USAGE);
    return 0;
  }

  // Say where it is about to write, so running it against the wrong database is obvious
  out(`Database: ${describeConnection(env.DATABASE_URL)}`);
  try {
    const result = await setupClient(db, parsed.input);
    out();
    out('OK: client set up');
    out(`  Business : ${result.businessName}`);
    out(`  Admin    : ${result.admin.username} (${result.admin.fullName})`);
    out();
    out('  Temporary password. It is shown only now; write it down, then log in with it');
    out('  and you will be asked to choose a new one:');
    out();
    out(`    ${result.temporaryPassword}`);
    out();
    return 0;
  } catch (error) {
    fail(
      error instanceof AppError
        ? `ERROR: ${error.message}`
        : `ERROR: setup failed: ${error instanceof Error ? error.message : error}`,
    );
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
