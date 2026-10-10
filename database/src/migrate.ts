// CLI: npm run db:migrate [-- TEST_DATABASE_URL]
import { describeConnection } from './client.js';
import { fail, loadRootEnv, out, urlFromEnv } from './cli.js';
import { runMigrations } from './migrator.js';

loadRootEnv();
const varName = process.argv[2] ?? 'DATABASE_URL';

try {
  const url = urlFromEnv(varName);
  const applied = await runMigrations(url);
  out(
    applied
      ? `✓ Migrations applied to ${varName} (${describeConnection(url)})`
      : 'No migrations generated yet — nothing to apply.',
  );
} catch (error) {
  fail(`✗ Migration failed for ${varName}: ${error instanceof Error ? error.message : error}`);
}
