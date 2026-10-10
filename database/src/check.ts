// CLI: npm run db:check [-- TEST_DATABASE_URL]
import { TLSSocket } from 'node:tls';
import type { PoolClient } from 'pg';
import { createDb, describeConnection } from './client.js';
import { fail, loadRootEnv, out, urlFromEnv } from './cli.js';

/**
 * Report TLS as seen from this machine's socket. The server-side view (pg_stat_ssl) is
 * misleading on Neon, whose proxy terminates TLS before the database. Reads pg's internal
 * `connection.stream` — acceptable for this diagnostic CLI only.
 */
function describeClientTls(client: PoolClient): string {
  const stream = (client as unknown as { connection?: { stream?: unknown } }).connection?.stream;
  if (!(stream instanceof TLSSocket)) {
    return 'NONE — connection is not encrypted';
  }
  return `${stream.getProtocol() ?? 'TLS'} · certificate verified: ${stream.authorized ? 'yes' : 'NO'}`;
}

loadRootEnv();
const varName = process.argv[2] ?? 'DATABASE_URL';

let url: string;
try {
  url = urlFromEnv(varName);
} catch (error) {
  fail(`✗ ${error instanceof Error ? error.message : error}`);
}

const { pool } = createDb(url, { max: 1 });
try {
  const started = Date.now();
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      server_version: string;
      database: string;
      version: string;
    }>(
      `select current_setting('server_version') as server_version,
              current_database() as database,
              version() as version`,
    );
    const row = rows[0];
    if (!row) {
      throw new Error('the server returned no rows');
    }
    out(`✓ ${varName} → ${describeConnection(url)}`);
    out(
      `  PostgreSQL ${row.server_version} · database "${row.database}" · ${Date.now() - started} ms`,
    );
    out(`  Encryption: ${describeClientTls(client)}`);
    out(`  ${row.version}`);
  } finally {
    client.release();
  }
} catch (error) {
  fail(`✗ Could not connect with ${varName}: ${error instanceof Error ? error.message : error}`);
} finally {
  await pool.end();
}
