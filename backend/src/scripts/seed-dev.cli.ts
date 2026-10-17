// Executable for seed-dev.ts: npm run db:seed
// Plain ASCII output, so it reads correctly in any Windows terminal.
import { describeConnection } from '@ds/database';
import { env } from '../config/env.js';
import { db, pool } from '../db.js';
import { AppError } from '../lib/errors.js';
import { fail, out } from './cli.js';
import { seedDev } from './seed-dev.js';

/** Run the seed and return the process exit code: 0 done or already seeded, 1 refused or failed. */
async function main(): Promise<number> {
  // Say where it is about to write, so running it against the wrong database is obvious
  out(`Database: ${describeConnection(env.DATABASE_URL)}`);
  try {
    const result = await seedDev(db, { nodeEnv: env.NODE_ENV });
    if (result.status === 'already-seeded') {
      out('Already seeded: this database already has the demo data. Nothing was changed.');
      return 0;
    }

    out();
    out('OK: demo data created');
    for (const branch of result.branches) {
      out(
        `  Branch ${branch.code} (${branch.name}): ${branch.itemsCreated} items in ${branch.categoriesCreated} categories, ${branch.openingMovements} with opening stock`,
      );
    }
    out();
    out('  Logins. These passwords are fixed, for development and testing only, and no one is');
    out('  asked to change them at the first login:');
    out();
    for (const account of result.accounts) {
      const where = account.role === 'admin' ? 'Admin' : `branches ${account.branches.join(', ')}`;
      out(
        `    ${account.username.padEnd(10)} ${account.password.padEnd(14)} ${account.fullName} - ${where}`,
      );
    }
    out();
    return 0;
  } catch (error) {
    fail(
      error instanceof AppError
        ? `ERROR: ${error.message}`
        : `ERROR: seed failed: ${error instanceof Error ? error.message : error}`,
    );
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
