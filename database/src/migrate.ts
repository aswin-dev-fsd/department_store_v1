// CLI: npm run db:migrate [-- TEST_DATABASE_URL]
import { describeConnection } from './client.js';
import { fail, loadRootEnv, out, urlFromEnv } from './cli.js';
import { runMigrations } from './migrator.js';

loadRootEnv();
const varName = process.argv[2] ?? 'DATABASE_URL';

try {
  const url = urlFromEnv(varName);
  const applied = await runMigrations(url);
  const target = `${varName} (${describeConnection(url)})`;
  if (applied === null) {
    out('No migrations generated yet — nothing to apply.');
  } else if (applied === 0) {
    out(`✓ ${target} is already up to date`);
  } else {
    out(`✓ Applied ${applied} new migration${applied === 1 ? '' : 's'} to ${target}`);
  }
} catch (error) {
  fail(`✗ Migration failed for ${varName}: ${error instanceof Error ? error.message : error}`);
}
